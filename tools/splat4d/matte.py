import os
import subprocess

import numpy as np

BIREFNET_REPOS = {
    "birefnet": "ZhengPeng7/BiRefNet",
    "birefnet-hr": "ZhengPeng7/BiRefNet_HR",
    "birefnet-matting": "ZhengPeng7/BiRefNet-matting",
    "birefnet-hr-matting": "ZhengPeng7/BiRefNet_HR-matting",
}
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class BiRefNetMatte:
    def __init__(self, variant, size, device):
        import torch
        from transformers import AutoModelForImageSegmentation

        self.torch = torch
        self.size = size
        self.device = device
        self.model = AutoModelForImageSegmentation.from_pretrained(BIREFNET_REPOS[variant], trust_remote_code=True)
        self.model.to(device).eval()
        if device != "cpu":
            self.model.half()

    def __call__(self, frame):
        import cv2

        height, width = frame.shape[:2]
        resized = cv2.resize(frame, (self.size, self.size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        normalized = (resized - IMAGENET_MEAN) / IMAGENET_STD
        batch = self.torch.from_numpy(normalized.transpose(2, 0, 1)[None]).to(self.device)
        if self.device != "cpu":
            batch = batch.half()
        with self.torch.no_grad():
            logits = self.model(batch)[-1]
        alpha = logits.sigmoid()[0, 0].float().cpu().numpy()
        return cv2.resize(alpha, (width, height), interpolation=cv2.INTER_CUBIC).clip(0.0, 1.0)


class VisionMatte:
    def __init__(self, binary_dir):
        self.binary = os.path.join(binary_dir, "vision_matte")
        source = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vision_matte.swift")
        if not os.path.exists(self.binary) or os.path.getmtime(self.binary) < os.path.getmtime(source):
            os.makedirs(binary_dir, exist_ok=True)
            subprocess.run(["swiftc", "-O", source, "-o", self.binary], check=True)
        self.process = None
        self.size = None

    def __call__(self, frame):
        height, width = frame.shape[:2]
        if self.size != (width, height):
            self.close()
            self.process = subprocess.Popen([self.binary, str(width), str(height)], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            self.size = (width, height)
        self.process.stdin.write(np.ascontiguousarray(frame).tobytes())
        self.process.stdin.flush()
        data = self.process.stdout.read(width * height)
        return np.frombuffer(data, dtype=np.uint8).reshape(height, width).astype(np.float32) / 255.0

    def close(self):
        if self.process is not None:
            self.process.stdin.close()
            self.process.wait()
            self.process = None


class CombinedMatte:
    def __init__(self, size, device, binary_dir, core=6, margin=12):
        import cv2

        self.vision = VisionMatte(binary_dir)
        self.refine = BiRefNetMatte("birefnet-matting", size, device)
        self.shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * core + 1, 2 * core + 1))
        self.grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * margin + 1, 2 * margin + 1))

    def __call__(self, frame):
        import cv2

        shape = (self.vision(frame) > 0.5).astype(np.uint8)
        alpha = self.refine(frame)
        alpha[cv2.erode(shape, self.shrink) > 0] = 1.0
        alpha[cv2.dilate(shape, self.grow) == 0] = 0.0
        return alpha


class DepthMatte:
    def __init__(self, split):
        self.split = split

    def __call__(self, frame, depth):
        import cv2

        near = (depth < self.split).astype(np.float32)
        near = cv2.morphologyEx(near, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        height, width = frame.shape[:2]
        return cv2.GaussianBlur(cv2.resize(near, (width, height), interpolation=cv2.INTER_LINEAR), (0, 0), 1.5)


def make_matte(kind, size, device, split=None, binary_dir="~/dev/MoVieS/bin"):
    if kind in BIREFNET_REPOS:
        return BiRefNetMatte(kind, size, device)
    if kind == "vision":
        return VisionMatte(os.path.expanduser(binary_dir))
    if kind == "combined":
        return CombinedMatte(size, device, os.path.expanduser(binary_dir))
    if kind == "depth":
        return DepthMatte(split)
    raise ValueError(f"unknown matte {kind}")
