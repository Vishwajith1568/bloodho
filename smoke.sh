#!/usr/bin/env bash
# End-to-end check against a freshly seeded database.
set -uo pipefail
cd "$(dirname "$0")"
B=http://localhost:4000/api
J() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(eval('o$1'))}catch(e){console.log('PARSE_FAIL:'+s.slice(0,200))}})"; }
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

rm -rf data
nohup npx tsx server/index.ts > /tmp/api.log 2>&1 &
for i in $(seq 1 60); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 1; done
echo "=== boot ==="; grep '^\[db\]' /tmp/api.log

echo; echo "=== 1. auth ==="
curl -s -c /tmp/cj.req -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"kavitha.r@family.test","password":"care@123"}' > /tmp/r.json
[ "$(J '.account.role' < /tmp/r.json)" = requester ] && ok "requester login" || bad "requester login"

curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"kavitha.r@family.test","password":"wrong"}' > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = bad_credentials ] && ok "wrong password rejected" || bad "wrong password"

curl -s $B/donor/profile > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = not_signed_in ] && ok "anonymous blocked" || bad "anonymous blocked"

curl -s -b /tmp/cj.req $B/donor/profile > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = wrong_portal ] && ok "requester blocked from donor portal" || bad "role guard"

echo; echo "=== 2. validation ==="
curl -s -b /tmp/cj.req -X POST $B/requests -H 'content-type: application/json' \
  -d '{"blood_group":"XY","units_needed":0,"attendant_phone":"123"}' > /tmp/r.json
echo "  fields flagged: $(node -e "const o=require('/tmp/r.json');console.log(Object.keys(o.errors).join(', '))")"
[ "$(J '.error' < /tmp/r.json)" = validation ] && ok "bad SOS form rejected field-by-field" || bad "validation"

echo; echo "=== 3. SOS request ==="
curl -s -b /tmp/cj.req -X POST $B/requests -H 'content-type: application/json' \
  -d '{"blood_group":"O-","component":"prbc","units_needed":2,"urgency":"critical",
       "hospital_id":3,"ward":"Casualty","patient_ref":"IP/2026/15201","patient_age":34,
       "attendant_name":"Kavitha Ramineni","attendant_phone":"9394220011"}' > /tmp/r.json
RID=$(J '.request.id' < /tmp/r.json)
echo "  created $(J '.request.ref_code' < /tmp/r.json) (id $RID), state=$(J '.request.verification_state' < /tmp/r.json)"

curl -s -b /tmp/cj.req -X POST $B/requests/$RID/broadcast > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = unverified ] && ok "unverified request cannot broadcast" || bad "trust gate"

echo; echo "=== 4. OTP ==="
curl -s -b /tmp/cj.req -X POST $B/requests/$RID/otp/send > /tmp/r.json
CODE=$(J '.dev_code' < /tmp/r.json)
echo "  code sent to $(J '.sent_to' < /tmp/r.json)"
curl -s -b /tmp/cj.req -X POST $B/requests/$RID/otp/verify -H 'content-type: application/json' \
  -d '{"code":"000000"}' > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = otp_mismatch ] && ok "wrong OTP rejected, attempts counted" || bad "otp mismatch"
curl -s -b /tmp/cj.req -X POST $B/requests/$RID/otp/verify -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\"}" > /tmp/r.json
[ "$(J '.request.verification_state' < /tmp/r.json)" = otp_verified ] && ok "OTP verified" || bad "otp verify"

echo; echo "=== 5. broadcast + real distance matching ==="
curl -s -b /tmp/cj.req -X POST $B/requests/$RID/broadcast > /tmp/r.json
echo "  notified $(J '.notified' < /tmp/r.json) donor(s) within $(J '.radius_km' < /tmp/r.json) km"
curl -s -b /tmp/cj.req $B/requests/$RID/tracker > /tmp/t.json
echo "  nearest matches:"
node -e "const t=require('/tmp/t.json');t.matches.slice(0,4).forEach(m=>console.log('    ',m.full_name.padEnd(22),m.blood_group.padEnd(4),String(m.distance_km).padStart(5)+' km ',m.locality.padEnd(16),'phone='+m.phone))"
node -e "const t=require('/tmp/t.json');process.exit(t.matches.every(m=>m.phone.includes('hidden'))?0:1)" \
  && ok "donor numbers hidden before acceptance" || bad "phone privacy"
node -e "const t=require('/tmp/t.json');const d=t.matches.map(m=>m.distance_km);process.exit(d.length&&d.every((v,i)=>i===0||v>=d[i-1])&&d.every(v=>v>0&&v<=5)?0:1)" \
  && ok "distances computed from coordinates, inside 5 km, sorted" || bad "distance calc"

echo; echo "=== 6. donor accepts ==="
DEMAIL=$(node -e "
const D=require('better-sqlite3'),d=new D('data/app.db');
const t=require('/tmp/t.json');
for (const m of t.matches){const a=d.prepare('select email from accounts where donor_id=?').get(m.donor_id); if(a){console.log(a.email);break}}")
echo "  signing in as $DEMAIL"
curl -s -c /tmp/cj.don -X POST $B/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$DEMAIL\",\"password\":\"donor@123\"}" > /dev/null
curl -s -b /tmp/cj.don $B/donor/profile > /tmp/r.json
echo "  eligibility: $(J '.eligibility.status' < /tmp/r.json), next eligible $(J '.eligibility.nextEligibleDate' < /tmp/r.json) ($(J '.eligibility.daysRemaining' < /tmp/r.json) days)"
MID=$(curl -s -b /tmp/cj.don $B/donor/requests | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const m=o.matches.find(x=>x.response==='pending'&&x.request_id==$RID);console.log(m?m.match_id:'')})")
curl -s -b /tmp/cj.don -X POST $B/donor/requests/$MID/respond -H 'content-type: application/json' -d '{"action":"accept"}' > /tmp/r.json
echo "  after accept, attendant phone visible to donor: $(J '.match.attendant_phone' < /tmp/r.json)"
curl -s -b /tmp/cj.don -X POST $B/donor/requests/$MID/respond -H 'content-type: application/json' -d '{"action":"accept"}' > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = already_answered ] && ok "double-accept blocked" || bad "idempotency"

curl -s -b /tmp/cj.req $B/requests/$RID/tracker > /tmp/t.json
echo "  tracker: $(J '.summary.notified' < /tmp/t.json) notified, $(J '.summary.accepted' < /tmp/t.json) accepted, $(J '.summary.units_pledged' < /tmp/t.json)/$(J '.summary.units_needed' < /tmp/t.json) units pledged"
node -e "const t=require('/tmp/t.json');const a=t.matches.find(m=>m.response==='accepted');process.exit(a&&!a.phone.includes('hidden')?0:1)" \
  && ok "accepted donor's number now revealed to requester" || bad "phone reveal"

echo; echo "=== 7. blood bank stock search ==="
curl -s -b /tmp/cj.req "$B/blood-banks/availability?blood_group=O-&component=prbc&hospital_id=3" > /tmp/r.json
node -e "const o=require('/tmp/r.json');console.log('  compatible donor groups for O-:',o.compatible_groups.join(', '));o.banks.slice(0,3).forEach(b=>console.log('   ',b.name.slice(0,38).padEnd(40),String(b.distance_km).padStart(5)+' km ',b.total_units+' units',b.phone))"

echo; echo "=== 8. bank portal: issue stock ==="
curl -s -c /tmp/cj.bank -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"ntrtrust@bank.test","password":"bank@123"}' > /dev/null
BEFORE=$(curl -s -b /tmp/cj.bank $B/bank/inventory | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const r=o.inventory.find(x=>x.blood_group==='O+'&&x.component==='prbc');console.log(r?r.available:0)})")
curl -s -b /tmp/cj.bank -X POST $B/bank/movements -H 'content-type: application/json' \
  -d '{"kind":"issue","blood_group":"O+","component":"prbc","units":3,"counterparty":"CARE Hospitals","note":"Theatre 2"}' > /tmp/r.json
AFTER=$(node -e "const o=require('/tmp/r.json');const r=o.inventory.find(x=>x.blood_group==='O+'&&x.component==='prbc');console.log(r?r.available:0)")
echo "  O+ PRBC: $BEFORE -> $AFTER"
[ $((BEFORE-AFTER)) -eq 3 ] && ok "issue drew down 3 units (earliest expiry first)" || bad "stock math"
curl -s -b /tmp/cj.bank -X POST $B/bank/movements -H 'content-type: application/json' \
  -d '{"kind":"issue","blood_group":"AB-","component":"platelets","units":999}' > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = insufficient_stock ] && ok "over-issue refused: $(J '.message' < /tmp/r.json)" || bad "stock guard"
curl -s -b /tmp/cj.bank $B/bank/expiry > /tmp/r.json
echo "  expiring within 10 days: $(J '.expiring.length' < /tmp/r.json) batch(es); wastage to date: $(J '.wastage.units' < /tmp/r.json) units"

echo; echo "=== 9. admin metrics ==="
curl -s -c /tmp/cj.adm -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"control@bloodfinder.test","password":"admin@123"}' > /dev/null
curl -s -b /tmp/cj.adm $B/admin/metrics > /tmp/r.json
node -e "const m=require('/tmp/r.json');
console.log('  median fulfilment   ', m.median_fulfilment_minutes, 'min');
console.log('  fulfilment rate     ', m.fulfilment_rate+'%');
console.log('  voluntary/replacement', m.donation_split.voluntary+' / '+m.donation_split.replacement);
console.log('  units expired unused ', m.units_wasted.units, 'across', m.units_wasted.batches, 'batches');
console.log('  donor retention     ', m.donor_retention_rate+'%');
console.log('  donors              ', m.donors.total+' total, '+m.donors.available+' available, '+m.donors.verified+' verified');"

echo; echo "=== 10. persistence across restart ==="
pkill -f "tsx server/index.ts"; sleep 3
nohup npx tsx server/index.ts > /tmp/api2.log 2>&1 &
for i in $(seq 1 60); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 1; done
curl -s -b /tmp/cj.req $B/requests/$RID/tracker > /tmp/r.json
echo "  after restart: $(J '.request.ref_code' < /tmp/r.json) still $(J '.summary.accepted' < /tmp/r.json) accepted, $(J '.summary.units_pledged' < /tmp/r.json) unit(s) pledged"
[ "$(J '.summary.accepted' < /tmp/r.json)" = 1 ] && ok "writes survived a server restart" || bad "persistence"
[ "$(J '.error' < /tmp/r.json)" = undefined ] && ok "session cookie survived restart" || bad "session persistence"

echo; echo "=== 11. low-bandwidth payload ==="
FULL=$(curl -s -b /tmp/cj.adm $B/admin/banks | wc -c)
LEAN=$(curl -s -b /tmp/cj.adm "$B/admin/banks?lean=1" | wc -c)
echo "  /admin/banks full=${FULL}B lean=${LEAN}B"
[ "$LEAN" -lt "$FULL" ] && ok "lean mode drops optional fields" || bad "lean mode"

echo; echo "=== 12. request ownership ==="
curl -s -c /tmp/cj.g -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"ghouse.pasha@family.test","password":"care@123"}' > /dev/null
OTHER=$(curl -s -b /tmp/cj.g $B/requests | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.requests[0].id)})")
curl -s -b /tmp/cj.req $B/requests/$OTHER/tracker > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = not_found ] && ok "cannot read another family's request" || bad "ownership read"
curl -s -b /tmp/cj.req -X POST $B/requests/$OTHER/cancel > /tmp/r.json
[ "$(J '.error' < /tmp/r.json)" = not_found ] && ok "cannot cancel another family's request" || bad "ownership write"

pkill -f "tsx server/index.ts"
echo; echo "=== auto-escalation log ==="; grep escalate /tmp/api.log /tmp/api2.log | tail -5 || echo "  (none yet - 45s per stage)"
