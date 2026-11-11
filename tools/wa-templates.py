#!/usr/bin/env python3
"""Submit the 5 WhatsApp templates (Tamil + English = 10) to a WhatsApp Business Account.

Run in Google Cloud Shell (the token stays in Secret Manager; it is never printed):
    cd ~/vellorecalltaxi && git fetch origin whatsapp-api && git checkout whatsapp-api && git pull
    python3 tools/wa-templates.py            # dry run: shows what would be sent
    python3 tools/wa-templates.py --send     # submits to Meta

The texts come from docs/whatsapp-templates.md (one source of truth). A template that already exists is
skipped (Meta answers "already exists"), so running it again is safe. Nothing is ever deleted.
"""
import json, re, subprocess, sys, urllib.request, urllib.error, os

WABA = os.environ.get('WABA', '29068467292795781')     # Vellore Call Taxi (real account)
GRAPH = 'https://graph.facebook.com/v21.0'
PROJECT = 'vellore-taxi23'
SAMPLES = {   # example values Meta needs for review, in variable order
    'vct_booking_confirmed': ['Priya', 'Mini', 'Katpadi', '10 Nov, 9:30 AM', '450', 'AB12CD'],
    'vct_driver_assigned': ['Priya', 'Murugan', 'Swift Dzire TN23AB1234', 'AB12CD'],
    'vct_trip_started': ['Priya', 'TN23AB1234', '9344640416'],
    'vct_trip_completed': ['Priya', '450', 'AB12CD'],
    'vct_booking_cancelled': ['Priya', 'AB12CD', '9344640416'],
}

def parse(md):
    out = []
    for sec in re.split(r'^## ', md, flags=re.M)[1:]:
        name = sec.split()[0]
        if not name.startswith('vct_'):
            continue
        for lang in ('ta', 'en'):
            m = re.search(r'\*\*' + lang + r'\*\*\s*```\n(.*?)\n```', sec, re.S)
            if not m:
                raise SystemExit(f'{name}/{lang}: text not found in docs/whatsapp-templates.md')
            out.append((name, lang, m.group(1)))
    return out

def check(name, text):
    n = sorted(set(int(x) for x in re.findall(r'\{\{(\d+)\}\}', text)))
    assert n == list(range(1, len(SAMPLES[name]) + 1)), f'{name}: variables {n} vs samples {len(SAMPLES[name])}'
    assert not re.match(r'\s*\{\{', text) and not re.search(r'\}\}\s*$', text), f'{name}: starts/ends with a variable'
    assert not re.search(r'\bPIN\b|OTP|code', text, re.I), f'{name}: looks like an OTP template'

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    items = parse(open(os.path.join(root, 'docs', 'whatsapp-templates.md'), encoding='utf-8').read())
    assert len(items) == 10, len(items)
    for name, lang, text in items:
        check(name, text)
    send = '--send' in sys.argv
    print(f'WhatsApp account {WABA}: {len(items)} templates ({"SENDING" if send else "dry run — add --send to submit"})')
    if not send:
        for name, lang, text in items:
            print(f'  {name} [{lang}] {len(text)} chars')
        return
    token = subprocess.run(['gcloud', 'secrets', 'versions', 'access', 'latest', '--secret=WA_TOKEN', '--project', PROJECT],
                           capture_output=True, text=True, check=True).stdout.strip()
    if not re.fullmatch(r'EAA[A-Za-z0-9]{100,}', token):
        raise SystemExit('WA_TOKEN does not look like a Meta token (extra text pasted with it?). Store it again: bash tools/wa-token.sh')
    hide = lambda m: m.replace(token, '[token]') if token else m
    ok = 0
    for name, lang, text in items:
        body = {'name': name, 'language': lang, 'category': 'UTILITY',
                'components': [{'type': 'BODY', 'text': text, 'example': {'body_text': [SAMPLES[name]]}}]}
        req = urllib.request.Request(f'{GRAPH}/{WABA}/message_templates', data=json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=30))
            print(f'OK    {name} [{lang}] status={r.get("status")} category={r.get("category")}'); ok += 1
        except urllib.error.HTTPError as e:
            err = json.loads(e.read() or b'{}').get('error', {})
            msg = hide(err.get('error_user_msg') or err.get('message') or str(e))
            msg = re.sub(r'EAA[A-Za-z0-9]{20,}', '[token]', msg)
            if 'already' in msg.lower() or err.get('error_subcode') == 2388024:
                print(f'SKIP  {name} [{lang}] already exists'); ok += 1
            else:
                print(f'FAIL  {name} [{lang}] {err.get("code")}/{err.get("error_subcode")}: {msg}')
    del token
    print(f'DONE {ok}/{len(items)}')

if __name__ == '__main__':
    main()
