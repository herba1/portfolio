import numpy as np
import torch

from inputs import log
from movies_mac import enter_movies


def vggt_cameras(movies_root, images, device="mps", dtype=torch.float16):
    enter_movies(movies_root)
    from extensions.vggt.vggt.models.vggt import VGGT
    from extensions.vggt.vggt.utils.pose_enc import pose_encoding_to_extri_intri

    model = getattr(VGGT, "pretrained", VGGT.from_pretrained)("facebook/VGGT-1B")
    model.track_head = None
    model.point_head = None
    model = model.eval().to(device=device, dtype=dtype)
    count, _, H, W = images.shape
    with torch.inference_mode():
        batch = torch.from_numpy(images).to(device=device, dtype=dtype)[None]
        aggregated, start = model.aggregator(batch)
        pose_enc = model.camera_head(aggregated)[-1].float()
        extrinsic, intrinsic = pose_encoding_to_extri_intri(pose_enc, (H, W))
    extrinsic = extrinsic[0].cpu().numpy().astype(np.float64)
    intrinsic = intrinsic[0].cpu().numpy().astype(np.float64)
    del model
    if device == "mps":
        torch.mps.empty_cache()
    W2C = np.tile(np.eye(4), (count, 1, 1))
    W2C[:, :3, :4] = extrinsic
    C2W = np.linalg.inv(W2C)
    first = np.linalg.inv(C2W[0])
    C2W = first[None] @ C2W
    fxfycxcy = np.stack([intrinsic[:, 0, 0] / W, intrinsic[:, 1, 1] / H, intrinsic[:, 0, 2] / W, intrinsic[:, 1, 2] / H], axis=1)
    hfov = float(np.degrees(2 * np.arctan(0.5 / np.median(fxfycxcy[:, 0]))))
    log(f"VGGT cameras: lens about {hfov:.1f} deg across")
    return C2W.astype(np.float32), fxfycxcy.astype(np.float32)
