import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const fails = [];

async function portal(name, email, password, routes) {
  const p = await b.newPage({ viewport:{width:1400,height:950}, deviceScaleFactor:1 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:4000/', { waitUntil:'domcontentloaded' });
  await p.fill('#email', email); await p.fill('#password', password);
  await p.click('button:has-text("Sign in")');
  await p.waitForTimeout(1200);
  console.log(`\n== ${name} == landed on ${new URL(p.url()).pathname}`);
  for (const [path, expect] of routes) {
    await p.goto('http://localhost:4000' + path, { waitUntil:'domcontentloaded' });
    await p.waitForTimeout(2200);
    const body = (await p.textContent('body')) || '';
    const blank = body.trim().length < 40;
    const ok = !blank && body.includes(expect);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${path.padEnd(22)} ${blank ? '[BLANK PAGE]' : ok ? '' : `missing "${expect}"`}`);
    if (!ok) fails.push(`${name} ${path}`);
    await p.screenshot({ path: `/tmp/w-${name}-${path.replace(/\//g,'_')}.png` });
  }
  if (errs.length) { console.log('  page errors:', errs.slice(0,3)); fails.push(`${name} pageerror`); }
  await p.close();
}

await portal('donor', 'sridhar.1@donor.test', 'donor@123', [
  ['/donor', 'Eligibility'],
  ['/donor/profile', 'Registration'],
  ['/donor/history', 'Milestones'],
  ['/donor/camps', 'Upcoming camps'],
  ['/donor/feedback', 'city control'],
]);

await portal('bank', 'ntrtrust@bank.test', 'bank@123', [
  ['/bank', 'Stock by group'],
  ['/bank/movements', 'Record a movement'],
  ['/bank/expiry', 'Use these first'],
  ['/bank/requests', 'raised against this centre'],
  ['/bank/verify', 'Counter-verification'],
  ['/bank/transfers', 'Ask another centre'],
  ['/bank/camps', 'Enter what a camp collected'],
]);

await portal('admin', 'control@bloodfinder.test', 'admin@123', [
  ['/admin', 'Median time to fulfil'],
  ['/admin/verification', 'Awaiting review'],
  ['/admin/flags', 'Open reports'],
  ['/admin/banks', 'Listed centres'],
  ['/admin/camps', 'Schedule a camp'],
  ['/admin/feedback', 'Feedback'],
]);

await portal('requester', 'kavitha.r@family.test', 'care@123', [
  ['/request/new', 'Patient and requirement'],
  ['/request/active', 'Open requests'],
  ['/request/banks', 'Stock near the hospital'],
  ['/request/history', 'Closed requests'],
  ['/request/feedback', 'city control'],
]);

console.log('\n' + (fails.length ? 'FAILURES: ' + fails.join(', ') : 'ALL ROUTES RENDERED'));
await b.close();
