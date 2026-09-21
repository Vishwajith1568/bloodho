import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const ok = (m)=>console.log('  ok   '+m); const bad=(m)=>{console.log('  FAIL '+m); fails.push(m);};
const fails=[];
const login = async (email,password) => {
  const p = await b.newPage({ viewport:{width:1400,height:950} });
  p.on('pageerror', e=>bad('pageerror: '+e.message));
  await p.goto('http://localhost:4000/',{waitUntil:'domcontentloaded'});
  await p.fill('#email',email); await p.fill('#password',password);
  await p.click('button:has-text("Sign in")'); await p.waitForTimeout(1500);
  return p;
};

console.log('== bank: record a receipt, check inventory moves ==');
const bank = await login('ntrtrust@bank.test','bank@123');
await bank.goto('http://localhost:4000/bank',{waitUntil:'domcontentloaded'}); await bank.waitForTimeout(1800);
const before = await bank.locator('tbody tr').first().locator('td').last().textContent();
await bank.goto('http://localhost:4000/bank/movements',{waitUntil:'domcontentloaded'}); await bank.waitForTimeout(1500);
await bank.selectOption('#mg','O+'); await bank.selectOption('#mc','whole_blood');
await bank.fill('#mu','5'); await bank.fill('#mcp','Republic Day camp');
await bank.click('button:has-text("Record movement")'); await bank.waitForTimeout(1200);
const banner = await bank.locator('.banner-ok').count();
banner ? ok('receipt recorded, confirmation shown') : bad('receipt confirmation');
await bank.goto('http://localhost:4000/bank',{waitUntil:'domcontentloaded'}); await bank.waitForTimeout(1800);
const after = await bank.locator('tbody tr').first().locator('td').last().textContent();
(Number(after)===Number(before)+5) ? ok(`inventory O+ total ${before} -> ${after}`) : bad(`inventory did not move (${before} -> ${after})`);

// over-issue must be refused with a real message
await bank.goto('http://localhost:4000/bank/movements',{waitUntil:'domcontentloaded'}); await bank.waitForTimeout(1200);
await bank.locator('label:has-text("Issue out")').click();
await bank.selectOption('#mg','AB-'); await bank.selectOption('#mc','platelets'); await bank.fill('#mu','999');
await bank.click('button:has-text("Record movement")'); await bank.waitForTimeout(1000);
const stopTxt = await bank.locator('.banner-stop').textContent().catch(()=>null);
stopTxt?.includes('on hand') ? ok('over-issue refused: '+stopTxt.trim()) : bad('over-issue guard in UI');

console.log('\n== admin: schedule a camp, verify a donor, action a flag ==');
const admin = await login('control@bloodfinder.test','admin@123');
await admin.goto('http://localhost:4000/admin/camps',{waitUntil:'domcontentloaded'}); await admin.waitForTimeout(1500);
await admin.click('button:has-text("Schedule camp")'); await admin.waitForTimeout(800);
const inval = await admin.locator('[aria-invalid="true"]').count();
inval>0 ? ok(`empty camp form flagged ${inval} fields`) : bad('camp validation');
await admin.fill('#ct','Metro Staff Donation Drive');
await admin.fill('#co','L&T Metro Rail Hyderabad');
await admin.fill('#cv','Miyapur Depot Auditorium');
await admin.fill('#cl','Miyapur');
await admin.fill('#cd','2026-11-14'); await admin.fill('#ccap','160');
await admin.click('button:has-text("Schedule camp")'); await admin.waitForTimeout(1400);
const campRows = await admin.locator('tbody tr', { hasText:'Metro Staff Donation Drive' }).count();
campRows ? ok('camp scheduled and listed') : bad('camp not listed after create');

await admin.goto('http://localhost:4000/admin/verification',{waitUntil:'domcontentloaded'}); await admin.waitForTimeout(1500);
const pv = await admin.locator('button:has-text("Award badge")').count();
if (pv) { await admin.locator('button:has-text("Award badge")').first().click(); await admin.waitForTimeout(1300);
  const pv2 = await admin.locator('button:has-text("Award badge")').count();
  pv2 === pv-1 ? ok(`verification queue ${pv} -> ${pv2}`) : bad('verification queue did not shrink');
} else bad('no pending verifications to test');

await admin.goto('http://localhost:4000/admin/flags',{waitUntil:'domcontentloaded'}); await admin.waitForTimeout(1500);
const of = await admin.locator('button:has-text("Uphold")').count();
if (of) { await admin.locator('button:has-text("Uphold")').first().click(); await admin.waitForTimeout(1300);
  const of2 = await admin.locator('button:has-text("Uphold")').count();
  of2 === of-1 ? ok(`open flags ${of} -> ${of2} (request cancelled)`) : bad('flag not resolved');
} else bad('no open flags');

console.log('\n== donor: pause, resume, answer a request ==');
const donor = await login('sridhar.1@donor.test','donor@123');
await donor.goto('http://localhost:4000/donor/profile',{waitUntil:'domcontentloaded'}); await donor.waitForTimeout(1500);
await donor.click('button:has-text("Pause requests")'); await donor.waitForTimeout(1200);
(await donor.locator('button:has-text("Start receiving again")').count()) ? ok('availability paused') : bad('pause toggle');
await donor.click('button:has-text("Start receiving again")'); await donor.waitForTimeout(1200);
(await donor.locator('button:has-text("Pause requests")').count()) ? ok('availability resumed') : bad('resume toggle');

console.log('\n== donor feedback lands in admin inbox ==');
await donor.goto('http://localhost:4000/donor/feedback',{waitUntil:'domcontentloaded'}); await donor.waitForTimeout(1200);
await donor.selectOption('#fcat','notifications');
await donor.fill('#fmsg','Alerts arrive even when I am marked unavailable for the week.');
await donor.click('button:has-text("Send feedback")'); await donor.waitForTimeout(1200);
(await donor.locator('.banner-ok').count()) ? ok('feedback sent from donor portal') : bad('feedback send');
await admin.goto('http://localhost:4000/admin/feedback',{waitUntil:'domcontentloaded'}); await admin.waitForTimeout(1600);
(await admin.locator('tbody tr',{hasText:'marked unavailable for the week'}).count())
  ? ok('appeared in city control inbox') : bad('feedback did not reach admin inbox');

console.log('\n'+(fails.length?'FAILURES: '+fails.join(' | '):'ALL ACTIONS WORKED'));
await b.close();
