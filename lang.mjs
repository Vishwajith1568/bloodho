import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const fails=[];
const p = await b.newPage({ viewport:{width:1400,height:950}, deviceScaleFactor:1 });
p.on('pageerror', e=>fails.push('pageerror '+e.message));

await p.goto('http://localhost:4000/',{waitUntil:'domcontentloaded'});
await p.fill('#email','kavitha.r@family.test'); await p.fill('#password','care@123');
await p.click('button:has-text("Sign in")'); await p.waitForTimeout(1800);

for (const [code, navWord, formWord, label] of [
  ['en','Raise a request','Blood group needed','English'],
  ['hi','अनुरोध दर्ज करें','आवश्यक रक्त समूह','हिंदी'],
  ['te','అభ్యర్థన నమోదు','అవసరమైన రక్త గ్రూపు','తెలుగు'],
]) {
  await p.selectOption('.topbar select', code);
  await p.waitForTimeout(900);
  const body = await p.textContent('body');
  const navOk = body.includes(navWord), formOk = body.includes(formWord);
  console.log(`  ${navOk&&formOk?'ok  ':'FAIL'} ${label.padEnd(8)} nav:${navOk?'y':'n'} sosForm:${formOk?'y':'n'}`);
  if(!(navOk&&formOk)) fails.push(label);
  await p.screenshot({ path:`/tmp/lang-${code}.png` });
}

// persistence across reload
await p.selectOption('.topbar select','te'); await p.waitForTimeout(600);
await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(2000);
const kept = (await p.textContent('body')).includes('అభ్యర్థన నమోదు');
console.log(`  ${kept?'ok  ':'FAIL'} language survives a reload`);
if(!kept) fails.push('persistence');

// chips translate too: open a tracker
await p.selectOption('.topbar select','hi'); await p.waitForTimeout(600);
await p.goto('http://localhost:4000/request/active',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1800);
const t2 = await p.textContent('body');
const chipOk = t2.includes('अति गंभीर') || t2.includes('प्रसारित हो रहा है');
console.log(`  ${chipOk?'ok  ':'FAIL'} status and urgency chips translated`);
if(!chipOk) fails.push('chips');
await p.screenshot({ path:'/tmp/lang-hi-table.png', fullPage:true });

// other portals
await p.click('button[title], .sidebar-foot button'); await p.waitForTimeout(1200);
await p.fill('#email','ntrtrust@bank.test'); await p.fill('#password','bank@123');
await p.click('button:has-text("Sign in")'); await p.waitForTimeout(1800);
const t3 = await p.textContent('body');
const bankOk = t3.includes('स्टॉक आवाजाही');
console.log(`  ${bankOk?'ok  ':'FAIL'} bank portal nav follows the same language`);
if(!bankOk) fails.push('bank nav');
await p.screenshot({ path:'/tmp/lang-hi-bank.png' });

console.log('\n'+(fails.length?'FAILURES: '+fails.join(' | '):'LANGUAGE SWITCH WORKS'));
await b.close();
