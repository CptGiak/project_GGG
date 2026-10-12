"""
Client for the Meshy API (https://api.meshy.ai): concept images -> 3D model -> rig, driven by a
brief (tools/meshy/briefs/<name>.json). Every task, request and downloaded file is recorded in
tools/meshy/jobs/<name>/job.json, so nothing paid for is lost: a finished step is never sent
again (unless --again), an interrupted one is resumed by polling the same task, and the outputs
are downloaded at once (Meshy keeps them only 3 days). The job folders are meant to be committed.

    python3 tools/meshy/meshy.py balance
    python3 tools/meshy/meshy.py concept rex       # concept sheets (image-to-image)
    python3 tools/meshy/meshy.py model rex         # textured 3D model in T-pose
    python3 tools/meshy/meshy.py rig rex           # optional: Meshy's own auto-rig
    python3 tools/meshy/meshy.py status rex        # tasks, credits, files; resumes pending tasks
    python3 tools/meshy/meshy.py model rex --images docs/art/sheets/rex_front.png docs/art/sheets/rex_back.png

The key comes from MESHY_API_KEY (Pro plan; set it in the environment settings, never in a
file), or is added by the environment as a network secret for api.meshy.ai. --test uses Meshy's public test key: no credits are used and every request returns the
same sample results, so it only checks the flow. --dry-run prints the requests without sending
them. Standard library only.

In a brief, a string "@<path>" is a local image sent as a data URI and "@concept:<shot>" is the
image made by that concept shot.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BRIEFS = os.path.join(HERE, 'briefs')
JOBS = os.path.join(HERE, 'jobs')
# outputs worth keeping; other formats (fbx, obj, usdz, stl...) are skipped unless --all-formats
KEEP_EXT = ('.glb', '.png', '.jpg', '.jpeg', '.webp')
BASE = os.environ.get('MESHY_BASE_URL', 'https://api.meshy.ai/openapi')   # override only for a local mock
TEST_KEY = 'msy_dummy_api_key_for_test_mode_12345678'

# API version of each endpoint
ENDPOINTS = {
    'text-to-image': 'v1',
    'image-to-image': 'v1',
    'image-to-3d': 'v1',
    'multi-image-to-3d': 'v1',
    'text-to-3d': 'v2',
    'remesh': 'v1',
    'retexture': 'v1',
    'rigging': 'v1',
    'animations': 'v1',
}

# credits per task as of Oct 2026 (Meshy API pricing), for the estimate printed before sending
IMAGE_CREDITS = {'nano-banana': 3, 'nano-banana-2': 6, 'nano-banana-pro': 9, 'gpt-image-2': 12}


def estimate(endpoint: str, body: dict) -> int | None:
    if endpoint in ('text-to-image', 'image-to-image'):
        return IMAGE_CREDITS.get(body.get('ai_model', ''))
    if endpoint in ('image-to-3d', 'multi-image-to-3d'):
        if body.get('model_type') == 'smart-topology' or body.get('ai_model') in ('meshy-6-lite', 'meshy-t2'):
            return 5 + (10 if body.get('should_texture', True) else 0)
        c = 20
        if body.get('should_texture', True):
            c += 15 if body.get('texture_resolution') == '8k' else 10
        if body.get('geometry_resolution'):
            c += 5
        return c
    return {'rigging': 5, 'animations': 3, 'remesh': 5, 'retexture': 10}.get(endpoint)


class MeshyError(RuntimeError):
    pass


# =============================================================================================
# HTTP
# =============================================================================================

class Api:
    def __init__(self, key: str, dry_run: bool = False):
        self.key = key
        self.dry_run = dry_run

    def _open(self, req: urllib.request.Request, timeout: float = 60.0):
        """urlopen with retries on rate limits, server errors and dropped connections"""
        delay = 2.0
        for attempt in range(6):
            try:
                return urllib.request.urlopen(req, timeout=timeout)
            except urllib.error.HTTPError as e:
                body = e.read().decode('utf-8', 'replace')
                if e.code == 429 or e.code >= 500:
                    if attempt == 5:
                        raise MeshyError(f'HTTP {e.code} after retries: {body[:300]}') from None
                    wait = float(e.headers.get('Retry-After') or delay)
                    print(f'  HTTP {e.code}, retry in {wait:.0f}s ({body[:120]})', flush=True)
                    time.sleep(wait)
                    delay = min(delay * 2, 60)
                    continue
                raise MeshyError(explain(e.code, body)) from None
            except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
                reason = str(getattr(e, 'reason', e))
                if 'Tunnel connection failed: 403' in reason or 'Forbidden' in reason:
                    host = urllib.parse.urlparse(req.full_url).hostname
                    raise MeshyError(f'{host} is not reachable from this session: the environment\'s network '
                                     f'policy blocks it (add it to the allowed domains). {reason}') from None
                if attempt == 5:
                    raise MeshyError(f'network error after retries: {reason}') from None
                print(f'  network error, retry in {delay:.0f}s ({reason})', flush=True)
                time.sleep(delay)
                delay = min(delay * 2, 60)
        raise MeshyError('unreachable')

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f'{BASE}/{path}'
        data = json.dumps(body).encode() if body is not None else None
        if self.dry_run:
            print(f'  [dry-run] {method} {url}')
            if body is not None:
                print('  ' + json.dumps(redact(body), indent=2).replace('\n', '\n  '))
            return {}
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
        if self.key:
            headers['Authorization'] = f'Bearer {self.key}'
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        with self._open(req) as r:
            return json.loads(r.read().decode('utf-8') or '{}')

    def create(self, endpoint: str, body: dict) -> str:
        res = self.call('POST', f'{ENDPOINTS[endpoint]}/{endpoint}', body)
        if self.dry_run:
            return 'dry-run'
        tid = res.get('result')
        if not isinstance(tid, str):
            raise MeshyError(f'unexpected create response: {res}')
        return tid

    def task(self, endpoint: str, tid: str) -> dict:
        return self.call('GET', f'{ENDPOINTS[endpoint]}/{endpoint}/{tid}')

    def wait(self, endpoint: str, tid: str, timeout: float = 1800.0) -> dict:
        t0 = time.time()
        every = 4.0
        last = None
        while True:
            t = self.task(endpoint, tid)
            st, pr = t.get('status'), t.get('progress')
            if (st, pr) != last:
                extra = f', {t["preceding_tasks"]} in the queue ahead' if st == 'PENDING' and t.get('preceding_tasks') else ''
                print(f'  {endpoint} {tid[:8]}: {st} {pr if pr is not None else ""}%{extra} ({time.time() - t0:.0f}s)', flush=True)
                last = (st, pr)
            if st in ('SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED'):
                return t
            if time.time() - t0 > timeout:
                raise MeshyError(f'timeout waiting for {endpoint} {tid} (still {st}); run "status" later to resume')
            time.sleep(every)
            every = min(every * 1.3, 15.0)

    def download(self, url: str, dest: str) -> str:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'ggg-meshy/1.0'})
        with self._open(req, timeout=300) as r, open(dest + '.part', 'wb') as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(dest + '.part', dest)
        return dest


def explain(code: int, body: str) -> str:
    try:
        msg = json.loads(body).get('message', body)
    except (ValueError, AttributeError):
        msg = body
    hint = {
        400: 'bad request (a parameter the endpoint does not accept?)',
        401: 'the API key was rejected (MESHY_API_KEY missing, wrong, or not a Pro plan)',
        402: 'not enough credits',
        403: 'forbidden (plan without API access?)',
        404: 'not found (task expired: Meshy keeps results for 3 days)',
        422: 'the input was not accepted (for rigging: not a valid humanoid)',
    }.get(code, '')
    return f'HTTP {code}: {msg}' + (f' -> {hint}' if hint else '')


def redact(body):
    """request body for printing / the job file: data URIs replaced by their size and hash"""
    if isinstance(body, dict):
        return {k: redact(v) for k, v in body.items()}
    if isinstance(body, list):
        return [redact(v) for v in body]
    if isinstance(body, str) and body.startswith('data:'):
        raw = body.split(',', 1)[1]
        return f'<data uri {len(raw) * 3 // 4} bytes sha256:{hashlib.sha256(raw.encode()).hexdigest()[:12]}>'
    return body


# =============================================================================================
# Job file
# =============================================================================================

class Job:
    def __init__(self, name: str):
        self.name = name
        self.dir = os.path.join(JOBS, name)
        self.path = os.path.join(self.dir, 'job.json')
        os.makedirs(self.dir, exist_ok=True)
        self.data = json.load(open(self.path)) if os.path.exists(self.path) else {'name': name, 'tasks': []}

    def save(self) -> None:
        tmp = self.path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.data, f, indent=2)
        os.replace(tmp, self.path)

    def tasks(self, step: str, shot: str | None = None, status: str | None = None) -> list:
        return [t for t in self.data['tasks'] if t['step'] == step and (shot is None or t.get('shot') == shot)
                and (status is None or t['status'] == status)]

    def latest(self, step: str, shot: str | None = None) -> dict | None:
        done = self.tasks(step, shot, 'SUCCEEDED')
        return done[-1] if done else None

    def add(self, entry: dict) -> dict:
        self.data['tasks'].append(entry)
        self.save()
        return entry


def file_name(path: tuple, url: str) -> str:
    """model_urls.glb -> model.glb, texture_urls[0].base_color -> texture_0_base_color.png"""
    parts = [p for p in path]
    name = '_'.join(parts)
    name = re.sub(r'^model_urls_', 'model_', name)
    name = re.sub(r'^texture_urls_', 'texture_', name)
    name = re.sub(r'_urls?(?=_|$)', '', name)
    name = re.sub(r'^result_', '', name)
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower() or '.bin'
    if name.endswith('_' + ext[1:]):
        name = name[:-len(ext)]
    return re.sub(r'[^A-Za-z0-9_.-]', '_', name) + ext


def urls_in(obj, path=()):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from urls_in(v, path + (str(k),))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from urls_in(v, path + (str(i),))
    elif isinstance(obj, str) and obj.startswith(('https://', 'http://')):
        yield path, obj


def finish(api: Api, job: Job, entry: dict, task: dict, all_formats: bool = False) -> dict:
    """record the final state and download every output right away (the links expire)"""
    entry['status'] = task.get('status')
    entry['finished'] = time.strftime('%Y-%m-%d %H:%M:%S')
    folder = os.path.join(job.dir, f'{entry["step"]}_{entry.get("shot") or "main"}_{entry["id"][:8]}')
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'task.json'), 'w') as f:
        json.dump(task, f, indent=2)
    if entry['status'] != 'SUCCEEDED':
        err = (task.get('task_error') or {}).get('message') or 'no message'
        entry['error'] = err
        job.save()
        raise MeshyError(f'{entry["endpoint"]} {entry["id"]} {entry["status"]}: {err}')
    files = {}
    for path, url in urls_in(task):
        if path and path[0] in ('image_url',):   # echo of an input, not an output
            continue
        name = file_name(path, url)
        if not all_formats and not name.lower().endswith(KEEP_EXT):
            continue
        dest = os.path.join(folder, name)
        if not os.path.exists(dest):
            try:
                api.download(url, dest)
            except MeshyError as e:
                print(f'  could not download {name}: {e}')
                continue
        files['.'.join(path)] = os.path.relpath(dest, ROOT)
        print(f'  saved {os.path.relpath(dest, ROOT)} ({os.path.getsize(dest) / 1e6:.2f} MB)')
    entry['files'] = files
    job.save()
    return entry


# =============================================================================================
# Steps
# =============================================================================================

def load_brief(name: str) -> dict:
    path = name if name.endswith('.json') else os.path.join(BRIEFS, f'{name}.json')
    with open(path) as f:
        return json.load(f)


def data_uri(path: str) -> str:
    full = path if os.path.isabs(path) else os.path.join(ROOT, path)
    mime = mimetypes.guess_type(full)[0] or 'image/png'
    if mime not in ('image/png', 'image/jpeg'):
        raise MeshyError(f'{path}: Meshy takes only .png / .jpg images')
    with open(full, 'rb') as f:
        return f'data:{mime};base64,' + base64.b64encode(f.read()).decode()


def concept_image(job: Job, shot: str) -> str:
    """path of the image made by a concept shot (first image output of its latest task)"""
    t = job.latest('concept', shot)
    if not t:
        raise MeshyError(f'concept shot "{shot}" has no finished task yet: run "concept" first')
    imgs = [p for k, p in sorted(t['files'].items()) if re.search(r'\.(png|jpe?g|webp)$', p) and 'thumbnail' not in k]
    if not imgs:
        raise MeshyError(f'concept shot "{shot}" produced no image file')
    return imgs[0]


def resolve(job: Job, value, dry_run: bool = False):
    """'@path' -> data URI of a local image, '@concept:<shot>' -> data URI of that shot's image"""
    if isinstance(value, dict):
        return {k: resolve(job, v, dry_run) for k, v in value.items() if not k.startswith('_')}
    if isinstance(value, list):
        return [resolve(job, v, dry_run) for v in value]
    if isinstance(value, str) and value.startswith('@'):
        ref = value[1:]
        if ref.startswith('concept:'):
            shot = ref.split(':', 1)[1]
            if dry_run and not job.latest('concept', shot):
                return f'<image of concept shot "{shot}">'
            return data_uri(concept_image(job, shot))
        return data_uri(ref)
    return value


def run_task(api: Api, job: Job, step: str, endpoint: str, body_spec: dict, shot: str | None = None,
             again: bool = False, timeout: float = 1800.0, all_formats: bool = False) -> dict | None:
    label = f'{step}{" " + shot if shot else ""}'
    # a task already paid for and still running is always resumed, never sent again
    pending = [t for t in job.tasks(step, shot) if t['status'] in ('PENDING', 'IN_PROGRESS', 'SUBMITTED')]
    done = job.latest(step, shot)
    if done and not again and not pending:
        print(f'{label}: already done ({done["id"]}), --again to make a new one')
        return done
    if pending:
        entry = pending[-1]
        print(f'{label}: resuming {entry["id"]}')
    else:
        body = resolve(job, body_spec, api.dry_run)
        cost = estimate(endpoint, body)
        print(f'{label}: {endpoint}, about {cost if cost is not None else "?"} credits'
              f'{" (test key: none)" if api.key == TEST_KEY else ""}')
        tid = api.create(endpoint, body)
        if api.dry_run:
            return None
        entry = job.add({'step': step, 'shot': shot, 'endpoint': endpoint, 'id': tid, 'status': 'SUBMITTED',
                         'test_mode': api.key == TEST_KEY, 'credits_estimate': cost,
                         'created': time.strftime('%Y-%m-%d %H:%M:%S'), 'request': redact(body)})
    task = api.wait(entry['endpoint'], entry['id'], timeout)
    return finish(api, job, entry, task, all_formats)


def step_concept(api, job, brief, a):
    shots = brief.get('concept') or []
    if not shots:
        raise MeshyError('the brief has no "concept" shots')
    for s in shots:
        if a.shot and s['shot'] not in a.shot:
            continue
        run_task(api, job, 'concept', s['endpoint'], s['body'], shot=s['shot'], again=a.again, timeout=a.timeout,
                 all_formats=a.all_formats)


def step_model(api, job, brief, a):
    m = dict(brief['model'])
    body = dict(m['body'])
    endpoint = m['endpoint']
    if a.images:
        body['image_urls' if endpoint == 'multi-image-to-3d' else 'image_url'] = (
            ['@' + p for p in a.images] if endpoint == 'multi-image-to-3d' else '@' + a.images[0])
    run_task(api, job, 'model', endpoint, body, again=a.again, timeout=a.timeout, all_formats=a.all_formats)


def step_rig(api, job, brief, a):
    model = job.latest('model')
    if not model and not api.dry_run:
        raise MeshyError('no finished model task to rig: run "model" first')
    body = {'input_task_id': model['id'] if model else '<model task id>', **brief.get('rig', {}).get('body', {})}
    run_task(api, job, 'rig', 'rigging', body, again=a.again, timeout=a.timeout, all_formats=a.all_formats)


def step_status(api, job, brief, a):
    if not job.data['tasks']:
        print('no tasks yet')
        return
    spent = 0
    for t in job.data['tasks']:
        if t['status'] in ('PENDING', 'IN_PROGRESS', 'SUBMITTED') and not api.dry_run:
            print(f'resuming {t["step"]} {t["id"]}')
            try:
                finish(api, job, t, api.wait(t['endpoint'], t['id'], a.timeout), a.all_formats)
            except MeshyError as e:
                print(f'  {e}')
        if t['status'] == 'SUCCEEDED' and not t.get('test_mode'):
            spent += t.get('credits_estimate') or 0
        print(f'{t["step"]:8} {t.get("shot") or "":6} {t["endpoint"]:18} {t["id"]}  {t["status"]:10} {t["created"]}'
              f'{"  test" if t.get("test_mode") else ""}')
        for k, p in (t.get('files') or {}).items():
            print(f'    {k}: {p}')
    print(f'about {spent} credits spent on finished tasks')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('cmd', choices=['balance', 'concept', 'model', 'rig', 'status'])
    ap.add_argument('brief', nargs='?', default='rex')
    ap.add_argument('--test', action='store_true', help="Meshy's public test key (no credits, sample results)")
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--again', action='store_true', help='make a new task even if this step is done')
    ap.add_argument('--shot', nargs='*', help='concept: only these shots')
    ap.add_argument('--images', nargs='+', help='model: use these local images instead of the brief / concept')
    ap.add_argument('--timeout', type=float, default=1800.0)
    ap.add_argument('--all-formats', action='store_true', help='also download fbx / obj / usdz / stl')
    a = ap.parse_args(argv)

    key = TEST_KEY if a.test else os.environ.get('MESHY_API_KEY', '').strip()
    if not key and not a.dry_run:
        # the environment may add the key on the way out (a network secret for api.meshy.ai)
        print('MESHY_API_KEY is not set: sending without a key (works only if the environment adds it '
              'for api.meshy.ai); --test uses the free sample key')
    api = Api(key, dry_run=a.dry_run)
    try:
        if a.cmd == 'balance':
            res = api.call('GET', 'v1/balance')
            print(f'balance: {res.get("balance")} credits' if res else '')
            return
        brief = load_brief(a.brief)
        job = Job(brief['name'] + ('_test' if a.test else ''))
        {'concept': step_concept, 'model': step_model, 'rig': step_rig, 'status': step_status}[a.cmd](api, job, brief, a)
    except MeshyError as e:
        sys.exit(f'meshy: {e}')


if __name__ == '__main__':
    main()
