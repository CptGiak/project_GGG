"""
Meshy-style texturing of an existing champion: back-project the Gemini front/back sheets onto the
3D model, then bake the result into a UV texture.

This is the "texture" stage of image-to-3D services (multi-view images -> back-projection onto
the geometry with visibility and view weights -> inpainting of what no view saw), done with the
two views we already have and no neural network:

  1. import the game GLB, pose it in the sheets' A-pose (same armature, same cameras as the
     build's sheet comparisons)
  2. new UV layout (Smart UV Project), bake the posed per-texel position and normal (Cycles EMIT)
  3. per texel: project into each sheet, depth test against a z-buffer splatted from the texels,
     keep it if it falls inside the figure mask, weight by how squarely the surface faces that
     view; texels no view sees keep the model's own flat colour
  4. optionally inpaint what no sheet saw from the nearest painted surface in 3D (--inpaint)
  5. dilate the islands, save the texture, render the sheet views, optionally export a GLB

  /root/blender-venv/bin/python tools/blender/project_sheets.py --out <dir> [--size 2048] [--inpaint] [--glb <path>]
"""
from __future__ import annotations

import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage  # noqa: E402

import bl_kit as K  # noqa: E402
import build_kaiser as BK  # noqa: E402

GLB = os.path.join(BK.ROOT, 'public', 'models', 'kaiser.glb')


# =============================================================================================
# Scene
# =============================================================================================

def import_model():
    K.reset_scene()
    bpy.ops.import_scene.gltf(filepath=GLB)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    # the GLB also carries small helper meshes (bone shapes): keep the character mesh only
    meshes = sorted((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: -len(o.data.polygons))
    for o in meshes[1:]:
        o.hide_render = True
    ob = meshes[0]
    # glTF splits vertices at every UV/normal seam, so each face arrives as its own island and
    # any unwrap packs ~15k separate triangles. Weld them back (weights travel with the verts).
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.set_sharp_from_angle(angle=1.0)
    print(f'[import] welded {n0} -> {len(ob.data.vertices)} vertices', flush=True)
    return arm, ob


def smart_uv(ob, margin: float = 0.004, name: str = 'ProjUV') -> str:
    """New UV layout. Returns the layer NAME: Python references to mesh layers dangle after
    an edit-mode round trip (touching one then crashes Blender with a bus error)."""
    me = ob.data
    uv = me.uv_layers.new(name=name)
    name = uv.name
    me.uv_layers.active = uv
    K.set_active(ob)
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=margin, area_weight=0.0, scale_to_bounds=True)
        # smart_project packs poorly on a many-piece character (~2% of the square used):
        # equalise texel density, then repack
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    return name


def use_uv(ob, uv_name: str) -> None:
    """Bakes write through the active *render* UV map: make the projection layout both."""
    for uv in ob.data.uv_layers:
        uv.active_render = uv.name == uv_name
    ob.data.uv_layers.active = ob.data.uv_layers[uv_name]


def bake_float(ob, size: int, kind: str, uv_name: str) -> np.ndarray:
    """Bakes the posed world position or normal of every texel (EMIT pass of a temporary
    material) into a float image. Returns (size, size, 4): rgb = value, a = coverage."""
    img = bpy.data.images.new(f'bake_{kind}', size, size, alpha=True, float_buffer=True)
    img.generated_color = (0, 0, 0, 0)
    mat = bpy.data.materials.new(f'BAKE_{kind}')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    nt.links.new(geo.outputs['Position' if kind == 'pos' else 'Normal'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    saved = [s.material for s in ob.material_slots]
    for s in ob.material_slots:
        s.material = mat
    use_uv(ob, uv_name)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 1
    sc.render.bake.margin = 0
    K.set_active(ob)
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=0)
    for s, m in zip(ob.material_slots, saved):
        s.material = m
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    return px


def bake_flat_colour(ob, size: int, uv_name: str) -> np.ndarray:
    """The model's own flat colours (Principled base colour, image textures included)."""
    img = bpy.data.images.new('bake_base', size, size, alpha=True)
    img.generated_color = (0, 0, 0, 0)
    for s in ob.material_slots:
        nt = s.material.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.nodes.active = tex
    use_uv(ob, uv_name)
    sc = bpy.context.scene
    sc.cycles.samples = 1
    K.set_active(ob)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=0)
    return np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)


# =============================================================================================
# Projection
# =============================================================================================

def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def project(pos, nrm, cov, sheet, view: str, power: float, eps: float, erode: int = 3):
    """Colour and weight of every texel seen from one sheet."""
    H, W = sheet.mask.shape
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    if view == 'front':
        col = sheet.cx + x / sheet.s
        depth = y            # camera on -Y looks towards +Y: smaller y is closer
        facing = np.clip(-nrm[..., 1], 0, 1)
    else:
        col = sheet.cx - x / sheet.s
        depth = -y
        facing = np.clip(nrm[..., 1], 0, 1)
    row = sheet.sole - z / sheet.s
    ci = np.round(col).astype(int)
    ri = np.round(row).astype(int)
    ok = cov & (ci >= 0) & (ci < W) & (ri >= 0) & (ri < H)
    # z-buffer splatted from the texels themselves (dense enough at 2k)
    zb = np.full((H, W), np.inf, np.float32)
    np.minimum.at(zb, (ri[ok], ci[ok]), depth[ok])
    zb = ndimage.grey_erosion(np.where(np.isfinite(zb), zb, 1e3), size=3)   # close pinholes
    visible = np.zeros_like(ok)
    visible[ok] = depth[ok] <= zb[ri[ok], ci[ok]] + eps
    mask = ndimage.binary_erosion(sheet.mask, iterations=erode)
    inside = np.zeros_like(ok)
    inside[ok] = mask[ri[ok], ci[ok]]
    use = ok & visible & inside
    colour = np.zeros(pos.shape[:2] + (3,), np.float32)
    # bilinear sample of the sheet
    img = sheet.img.astype(np.float32) / 255.0
    c0 = np.clip(np.floor(col[use]).astype(int), 0, W - 2)
    r0 = np.clip(np.floor(row[use]).astype(int), 0, H - 2)
    fc = (col[use] - c0)[:, None]
    fr = (row[use] - r0)[:, None]
    s = (img[r0, c0] * (1 - fc) * (1 - fr) + img[r0, c0 + 1] * fc * (1 - fr)
         + img[r0 + 1, c0] * (1 - fc) * fr + img[r0 + 1, c0 + 1] * fc * fr)
    colour[use] = srgb_to_lin(s)
    w = np.where(use, facing ** power, 0.0).astype(np.float32)
    return colour, w


def inpaint_unseen(rgb, pos, nrm, seen, unseen, base, radius: float = 0.06, k: int = 12, keep_base: float = 0.3):
    """What no sheet saw (the sides) takes the colour of the nearest painted surface in 3D,
    weighted by distance and by how similar the surface orientation is: the poor man's version
    of the diffusion inpainting image-to-3D services run on occluded regions. Texels with no
    painted neighbour within `radius` keep the model's own flat colour."""
    from scipy.spatial import cKDTree
    sp, sn, sc = pos[seen], nrm[seen], rgb[seen]
    if len(sp) > 400_000:
        idx = np.random.RandomState(0).choice(len(sp), 400_000, replace=False)
        sp, sn, sc = sp[idx], sn[idx], sc[idx]
    up, un = pos[unseen], nrm[unseen]
    d, nb = cKDTree(sp).query(up, k=k, distance_upper_bound=radius)
    ok = np.isfinite(d)
    nbc = np.where(ok, nb, 0)
    align = np.clip(np.einsum('ij,ikj->ik', un, sn[nbc]), 0, 1) + 0.05
    w = np.where(ok, align / np.maximum(d, 1e-3), 0.0)
    tot = w.sum(1)
    col = (sc[nbc] * w[..., None]).sum(1) / np.maximum(tot, 1e-9)[:, None]
    have = tot > 0
    out = rgb.copy()
    fill = base[unseen].copy()
    fill[have] = col[have] * (1 - keep_base) + base[unseen][have] * keep_base
    out[unseen] = fill
    return out, have.mean() if len(have) else 0.0


def dilate(rgb: np.ndarray, valid: np.ndarray, steps: int = 16) -> np.ndarray:
    """Pushes island colours outwards so mip-mapping and bilinear filtering never pick the
    background (the usual bake margin)."""
    out = rgb.copy()
    v = valid.copy()
    for _ in range(steps):
        grown = ndimage.binary_dilation(v)
        ring = grown & ~v
        if not ring.any():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(v.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh_v = np.roll(v, (dy, dx), (0, 1))
            sh_c = np.roll(out, (dy, dx), (0, 1))
            acc += sh_c * sh_v[..., None]
            cnt += sh_v
        out[ring] = acc[ring] / np.maximum(cnt[ring], 1)[:, None]
        v = grown
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=2048)
    ap.add_argument('--power', type=float, default=1.2, help='view weight = facing^power')
    ap.add_argument('--base', type=float, default=0.08, help='weight of the model flat colour')
    ap.add_argument('--eps', type=float, default=0.02, help='depth tolerance (m)')
    ap.add_argument('--glb', default='', help='also export the textured, rigged model to this .glb path')
    ap.add_argument('--inpaint', action='store_true', help='fill unseen texels from painted 3D neighbours')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    S = BK.Sheets()
    arm, ob = import_model()
    uv_name = smart_uv(ob)
    BK.pose_sheet(arm)
    bpy.context.view_layer.update()
    N = a.size
    pos = bake_float(ob, N, "pos", uv_name)
    nrm = bake_float(ob, N, 'nrm', uv_name)
    cov = np.linalg.norm(nrm[..., :3], axis=-1) > 0.5   # the bake leaves alpha at 1 everywhere
    n = nrm[..., :3]
    n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    base = bake_flat_colour(ob, N, uv_name)
    print(f'[bake] {cov.sum()} texels covered, {time.time() - t0:.1f}s', flush=True)
    cf, wf = project(pos[..., :3], n, cov, S.front, 'front', a.power, a.eps)
    cb, wb = project(pos[..., :3], n, cov, S.back, 'back', a.power, a.eps)
    wbase = np.where(cov, a.base, 0.0).astype(np.float32)
    tot = wf + wb + wbase
    rgb = (cf * wf[..., None] + cb * wb[..., None] + base[..., :3] * wbase[..., None]) / np.maximum(tot, 1e-6)[..., None]
    seen = cov & ((wf + wb) > 0.05)
    unseen = cov & ~seen
    print(f'[project] seen by a sheet: {seen.sum() / max(cov.sum(), 1) * 100:.1f}% of the surface', flush=True)
    if a.inpaint:
        rgb, frac = inpaint_unseen(rgb, pos[..., :3], n, seen, unseen, base[..., :3])
        print(f'[inpaint] {frac * 100:.1f}% of the unseen texels filled from painted neighbours', flush=True)
    rgb = dilate(rgb, cov)
    # back to sRGB 8-bit, image origin top-left (Blender pixels start bottom-left)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.clip(rgb, 0, None) ** (1 / 2.4) - 0.055)
    tex_path = os.path.join(a.out, 'kaiser_projected.png')
    Image.fromarray((np.clip(srgb, 0, 1)[::-1] * 255).astype(np.uint8)).save(tex_path)
    cov_img = np.stack([wf / np.maximum(tot, 1e-6), wb / np.maximum(tot, 1e-6), wbase / np.maximum(tot, 1e-6)], -1)
    Image.fromarray((np.clip(cov_img, 0, 1)[::-1] * 255).astype(np.uint8)).save(os.path.join(a.out, 'kaiser_projection_weights.png'))
    # one textured material on the new UVs
    mat = bpy.data.materials.new('kaiser_projected')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(tex_path)
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = uv_name
    nt.links.new(uvn.outputs[0], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    # render the sheet views (flat, like the sheets) + a 3/4 view
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    outn = nt.nodes['Material Output']
    nt.links.new(em.outputs[0], outn.inputs['Surface'])
    for view in ('front', 'back'):
        w, h = BK.view_camera(S, view, 1)
        K.setup_render(w, h, 8)
        K.render_to(os.path.join(a.out, f'proj_{view}.png'))
    nt.links.new(bsdf.outputs[0], outn.inputs['Surface'])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, 'kaiser_projected.blend'))
    if a.glb:
        # rest pose (T-pose) again; the projection UVs become the only UV map so the engine's
        # first texture coordinate set is the one that carries the painted texture
        K.pose_reset(arm)
        for uv in list(ob.data.uv_layers):
            if uv.name != uv_name:
                ob.data.uv_layers.remove(uv)
        K.export_glb(a.glb, [ob, arm])
        print(f'[glb] {a.glb} {os.path.getsize(a.glb) // 1024} KB', flush=True)
    print(f'[done] {time.time() - t0:.1f}s', flush=True)


if __name__ == '__main__':
    main()
