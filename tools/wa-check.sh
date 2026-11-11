#!/usr/bin/env bash
# What can the stored WA_TOKEN see? Prints Meta's answers with any token masked. Changes nothing.
T=$(gcloud secrets versions access latest --secret=WA_TOKEN --project vellore-taxi23)
m(){ sed -E 's/EAA[A-Za-z0-9]{10,}/[token]/g'; }
g(){ echo "== $1"; curl -s -H "Authorization: Bearer $T" "https://graph.facebook.com/v21.0/$1" | m; echo; }
g "me?fields=id,name"
g "me/permissions"
g "29068467292795781?fields=id,name"
g "1431624235788093/owned_whatsapp_business_accounts?fields=id,name"
g "1431624235788093/client_whatsapp_business_accounts?fields=id,name"
unset T
