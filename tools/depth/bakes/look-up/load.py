import cv2, numpy as np, sys
im = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32)
H, W, _ = im.shape
bot = int((90 + 40) / 180 * H)
crop = im[:bot]
np.save(sys.argv[2], crop.astype(np.float16))
small = cv2.resize(crop, (W // 4, bot // 4), interpolation=cv2.INTER_AREA)
np.save(sys.argv[3], small)
print(crop.shape, small.shape)
