import cv2
import numpy as np

from inputs import log

RATIO = 0.75
MIN_INLIERS = 30


def gray(image):
    return cv2.cvtColor((image.transpose(1, 2, 0) * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)


def intrinsics(fxfycxcy, W, H):
    fx, fy, cx, cy = fxfycxcy * np.array([W, H, W, H])
    return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float64)


def unproject(points, depth, K):
    px = np.clip(points[:, 0], 0, depth.shape[1] - 1)
    py = np.clip(points[:, 1], 0, depth.shape[0] - 1)
    z = cv2.remap(depth.astype(np.float32), px.astype(np.float32)[None], py.astype(np.float32)[None], cv2.INTER_LINEAR)[0]
    x = (points[:, 0] - K[0, 2]) / K[0, 0] * z
    y = (points[:, 1] - K[1, 2]) / K[1, 1] * z
    return np.stack([x, y, z], axis=1), z


def estimate_poses(images, depths, fxfycxcy, static_masks=None):
    count, _, H, W = images.shape
    K = intrinsics(fxfycxcy[0], W, H)
    sift = cv2.SIFT_create(nfeatures=4000)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    features = []
    for i in range(count):
        mask = None if static_masks is None else static_masks[i].astype(np.uint8) * 255
        features.append(sift.detectAndCompute(gray(images[i]), mask))

    C2W = np.tile(np.eye(4), (count, 1, 1))
    for i in range(1, count):
        best = None
        for j in range(max(0, i - 3), i):
            (kp_j, des_j), (kp_i, des_i) = features[j], features[i]
            if des_j is None or des_i is None or len(kp_j) < 8 or len(kp_i) < 8:
                continue
            pairs = [m for m, n in (p for p in matcher.knnMatch(des_j, des_i, k=2) if len(p) == 2) if m.distance < RATIO * n.distance]
            if len(pairs) < MIN_INLIERS:
                continue
            source = np.float32([kp_j[m.queryIdx].pt for m in pairs])
            target = np.float32([kp_i[m.trainIdx].pt for m in pairs])
            camera_points, z = unproject(source, depths[j], K)
            valid = z > 0
            world = (C2W[j][:3, :3] @ camera_points[valid].T).T + C2W[j][:3, 3]
            ok, rvec, tvec, inliers = cv2.solvePnPRansac(
                world, target[valid].astype(np.float64), K, None,
                iterationsCount=2000, reprojectionError=2.0, confidence=0.999, flags=cv2.SOLVEPNP_EPNP,
            )
            if not ok or inliers is None or len(inliers) < MIN_INLIERS:
                continue
            rvec, tvec = cv2.solvePnPRefineLM(world[inliers[:, 0]], target[valid][inliers[:, 0]].astype(np.float64), K, None, rvec, tvec)
            if best is None or len(inliers) > best[0]:
                best = (len(inliers), rvec, tvec, j)
        if best is None:
            log(f"pose {i}: no reliable match, holding the previous camera")
            C2W[i] = C2W[i - 1]
            continue
        R, _ = cv2.Rodrigues(best[1])
        W2C = np.eye(4)
        W2C[:3, :3] = R
        W2C[:3, 3] = best[2][:, 0]
        C2W[i] = np.linalg.inv(W2C)
    return C2W.astype(np.float32)


def rotation_degrees(a, b):
    R = a[:3, :3].T @ b[:3, :3]
    return float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))))


def locate(targets, references, depths, C2W, fxfycxcy, nearest):
    count, _, H, W = targets.shape
    K = intrinsics(fxfycxcy[0], W, H)
    sift = cv2.SIFT_create(nfeatures=4000)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    reference_features = [sift.detectAndCompute(gray(r), None) for r in references]
    located = np.tile(np.eye(4), (count, 1, 1))
    for i in range(count):
        kp_i, des_i = sift.detectAndCompute(gray(targets[i]), None)
        best = None
        for j in nearest[i]:
            kp_j, des_j = reference_features[j]
            if des_j is None or des_i is None:
                continue
            pairs = [m for m, n in (p for p in matcher.knnMatch(des_j, des_i, k=2) if len(p) == 2) if m.distance < RATIO * n.distance]
            if len(pairs) < MIN_INLIERS:
                continue
            source = np.float32([kp_j[m.queryIdx].pt for m in pairs])
            target = np.float32([kp_i[m.trainIdx].pt for m in pairs])
            camera_points, z = unproject(source, depths[j], K)
            valid = z > 0
            world = (C2W[j][:3, :3] @ camera_points[valid].T).T + C2W[j][:3, 3]
            ok, rvec, tvec, inliers = cv2.solvePnPRansac(
                world, target[valid].astype(np.float64), K, None,
                iterationsCount=2000, reprojectionError=2.0, confidence=0.999, flags=cv2.SOLVEPNP_EPNP,
            )
            if not ok or inliers is None or len(inliers) < MIN_INLIERS:
                continue
            if best is None or len(inliers) > best[0]:
                best = (len(inliers), rvec, tvec)
        if best is None:
            located[i] = C2W[nearest[i][0]]
            continue
        R, _ = cv2.Rodrigues(best[1])
        W2C = np.eye(4)
        W2C[:3, :3] = R
        W2C[:3, 3] = best[2][:, 0]
        located[i] = np.linalg.inv(W2C)
    return located.astype(np.float32)
