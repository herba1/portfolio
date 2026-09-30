import importlib.machinery
import importlib.util
import os
import sys
import types

import torch
import torch.nn.functional as F


def stub_module(name):
    module = types.ModuleType(name)
    module.__spec__ = importlib.machinery.ModuleSpec(name, None)
    return module


def install_cuda_shims():
    if importlib.util.find_spec("xformers") is None:
        ops = stub_module("xformers.ops")
        ops.unbind = torch.unbind

        def memory_efficient_attention(q, k, v, p=0.0):
            return F.scaled_dot_product_attention(
                q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2), dropout_p=p
            ).transpose(1, 2)

        ops.memory_efficient_attention = memory_efficient_attention
        root = stub_module("xformers")
        root.ops = ops
        sys.modules["xformers"], sys.modules["xformers.ops"] = root, ops

    def unavailable(name):
        def fail(*args, **kwargs):
            raise NotImplementedError(f"{name} is CUDA-only and unused by the exporter")

        return fail

    if importlib.util.find_spec("gsplat") is None:
        module = stub_module("gsplat")
        module.rasterization = unavailable("gsplat")
        sys.modules["gsplat"] = module
    if importlib.util.find_spec("torch_scatter") is None:
        module = stub_module("torch_scatter")
        module.scatter_add = unavailable("torch_scatter")
        module.scatter_max = unavailable("torch_scatter")
        sys.modules["torch_scatter"] = module


def chunked_attention(query_chunk):
    def attention(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None, **kwargs):
        if q.shape[-2] <= query_chunk or attn_mask is not None or is_causal:
            return F.scaled_dot_product_attention(q, k, v, attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale)
        return torch.cat([
            F.scaled_dot_product_attention(q[..., i:i + query_chunk, :], k, v, dropout_p=dropout_p, scale=scale)
            for i in range(0, q.shape[-2], query_chunk)
        ], dim=-2)

    return attention


def install_chunked_attention(query_chunk):
    functional = types.ModuleType("chunked_functional")
    functional.__dict__.update(F.__dict__)
    functional.scaled_dot_product_attention = chunked_attention(query_chunk)
    for name in ("src.models.networks.attention", "extensions.vggt.vggt.layers.attention", "vggt.layers.attention"):
        module = sys.modules.get(name)
        if module is not None:
            module.F = functional


def skip_vggt_download():
    from extensions.vggt.vggt.models.vggt import VGGT

    def untrained(cls, *args, **kwargs):
        return cls(enable_camera=False, enable_track=False)

    VGGT.from_pretrained = classmethod(untrained)


def enter_movies(movies_root):
    movies_root = os.path.abspath(os.path.expanduser(movies_root))
    os.chdir(movies_root)
    for path in (movies_root, os.path.join(movies_root, "extensions", "vggt")):
        if path not in sys.path:
            sys.path.insert(0, path)
    install_cuda_shims()
    return movies_root


def load_movies(movies_root, device, dtype=torch.float32, query_chunk=1024):
    enter_movies(movies_root)
    skip_vggt_download()
    from accelerate import init_empty_weights
    from safetensors.torch import load_file
    from src.models import SplatRecon
    from src.options import opt_dict

    install_chunked_attention(query_chunk)
    opt = opt_dict["movies"]
    opt.memory_efficient_attention = False
    with init_empty_weights(include_buffers=False):
        model = SplatRecon(opt, load_lpips=False)
    state = load_file("resources/movies_ckpt.safetensors", device="cpu")
    model.load_state_dict(state, strict=True, assign=True)
    del state
    leftover = [name for name, t in list(model.named_parameters()) + list(model.named_buffers()) if t.is_meta]
    if leftover:
        raise RuntimeError(f"tensors not in checkpoint: {leftover[:8]}")
    model = model.eval().to(device=device, dtype=dtype)
    return model, opt


def parameter_count(model):
    return sum(p.numel() for p in model.parameters())
