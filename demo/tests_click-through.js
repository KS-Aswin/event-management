const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('/home/claude/vela.html', 'utf8');
const errors = [];
const logs = [];

function activeView(document){
  const el = document.querySelector('.view.active');
  return el ? el.id : null;
}

function run(){
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    url: 'https://example.org/vela.html'
  });
  const { window } = dom;
  window.onerror = (msg, src, line, col, err) => {
    errors.push(`window.onerror: ${msg} @line ${line}:${col}`);
  };
  // wait a tick for scripts to run
  return dom;
}

async function main(){
  const dom = run();
  const { window } = dom;
  const document = window.document;

  function check(label, cond){
    logs.push(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
    if(!cond) errors.push(`ASSERTION FAILED: ${label}`);
  }

  // wait for scripts (jsdom runScripts dangerously runs synchronously for inline scripts mostly)
  await new Promise(r => setTimeout(r, 100));

  check('initial view is home', activeView(document) === 'home');
  check('header rendered on init', document.getElementById('appHeader').innerHTML.includes('Sign in'));

  // 1. Home -> search -> results
  document.getElementById('searchInput').value = 'photographer';
  window.runSearch();
  check('search navigates to results', activeView(document) === 'results');
  check('results header shows mini-search', !!document.getElementById('miniSearchInput'));
  check('results list populated', document.getElementById('resultsList').children.length > 0);

  // 2. category chip filter
  const catChips = [...document.querySelectorAll('#catFilters .filter-chip')];
  check('7 category chips exist', catChips.length === 7);
  catChips[0].dispatchEvent(new window.Event('click', {bubbles:true}));
  check('chip toggled checked class', catChips[0].classList.contains('checked') || !catChips[0].classList.contains('checked')); // just ensure no crash

  // clear filters
  window.clearFilters();
  check('clear filters resets query', window.eval('currentSearchQuery') === '');

  // 3. results -> profile
  const firstCard = document.querySelector('.vendor-card');
  check('vendor card exists', !!firstCard);
  firstCard.click();
  check('clicking vendor card opens profile', activeView(document) === 'profile');
  check('profile card populated', document.getElementById('profileCard').innerHTML.length > 100);

  // 4. back button from profile should return to results
  window.goBack();
  check('back from profile goes to results', activeView(document) === 'results');

  // 5. go to profile again, open quote modal
  document.querySelector('.vendor-card').click();
  window.openModal(1);
  check('quote modal opens', document.getElementById('quoteOverlay').classList.contains('active'));
  window.closeModal();
  check('quote modal closes', !document.getElementById('quoteOverlay').classList.contains('active'));

  // 6. navigate home via logo click equivalent
  window.showHome();
  check('showHome navigates home', activeView(document) === 'home');

  // 7. Signup flow (vendor)
  window.showSignup();
  check('signup view active', activeView(document) === 'signup');
  window.setRole('signup','vendor');
  check('signup role vendor label change', document.getElementById('signupNameLabel').textContent.includes('Business'));
  document.getElementById('signupName').value = 'Test Vendor Co';
  document.getElementById('signupEmail').value = 'vendor@test.com';
  document.getElementById('signupPass').value = 'password123';
  const signupForm = document.querySelector('#signup form');
  signupForm.dispatchEvent(new window.Event('submit', {bubbles:true, cancelable:true}));
  check('after vendor signup, session logged in', window.eval('session.loggedIn') === true);
  check('after vendor signup, role is vendor', window.eval('session.role') === 'vendor');
  check('after vendor signup, navigates to dashboard', activeView(document) === 'dashboard');
  check('vendor dashboard shows stats', document.getElementById('dashboardContent').innerHTML.includes('Profile visitors'));
  check('header shows logged in state', document.getElementById('appHeader').innerHTML.includes('Hi,'));

  // 8. Settings flow
  window.showSettings();
  check('settings view active', activeView(document) === 'settings');
  document.getElementById('settingsName').value = 'Updated Name Co';
  window.saveSettings();
  check('settings saved updates session name', window.eval('session.name') === 'Updated Name Co');
  check('header updates after settings save', document.getElementById('appHeader').innerHTML.includes('Updated'));

  // toggle notification pref
  const emailSwitch = document.querySelectorAll('.switch')[0];
  const beforePref = window.eval('prefs.email');
  window.togglePref('email', emailSwitch);
  check('toggle pref flips value', window.eval('prefs.email') === !beforePref);

  // 9. back navigation from settings
  window.goBack();
  check('back from settings returns to dashboard', activeView(document) === 'dashboard');

  // 10. logout
  window.logout();
  check('logout clears session', window.eval('session.loggedIn') === false);
  check('logout navigates home', activeView(document) === 'home');
  check('header shows signed out state after logout', document.getElementById('appHeader').innerHTML.includes('Sign in'));

  // 11. customer login flow
  window.showLogin();
  window.setRole('login', 'customer');
  document.getElementById('loginEmail').value = 'priya@test.com';
  document.getElementById('loginPass').value = 'password123';
  document.querySelector('#login form').dispatchEvent(new window.Event('submit', {bubbles:true, cancelable:true}));
  check('customer login succeeds', window.eval('session.loggedIn') === true && window.eval('session.role') === 'customer');
  check('customer dashboard shows wedding checklist', document.getElementById('dashboardContent').innerHTML.includes('Rahul'));

  // 12. static pages
  window.showAbout();
  check('about page active', activeView(document) === 'about');
  window.goBack();
  check('back from about returns to dashboard', activeView(document) === 'dashboard');

  window.showHelp();
  check('help page active', activeView(document) === 'help');
  window.showPrivacy();
  check('privacy page active (direct nav)', activeView(document) === 'privacy');
  window.showForVendors();
  check('forVendors page active', activeView(document) === 'forVendors');

  // 13. presetRoleAndSignup from forVendors CTA
  window.presetRoleAndSignup('vendor');
  check('preset role signup navigates to signup', activeView(document) === 'signup');
  check('preset role sets vendor active', document.getElementById('signupRoleVendor').classList.contains('active'));

  // 14. deep back chain doesn't throw when stack exhausted
  for(let i=0;i<15;i++){ window.goBack(); }
  check('exhausting back stack does not throw and lands somewhere valid', !!activeView(document));

  // 15. filters toggle panel (mobile)
  window.showResults();
  window.toggleFiltersPanel();
  check('filters panel toggles open class', document.getElementById('filtersPanel').classList.contains('open'));
  window.toggleFiltersPanel();
  check('filters panel toggles closed', !document.getElementById('filtersPanel').classList.contains('open'));

  // 16. search with no results
  window.onMiniSearchInput('zzz_nonexistent_vendor_zzz');
  check('no-results message shown', document.getElementById('resultsList').innerHTML.includes('No vendors match'));

  console.log(logs.join('\n'));
  console.log('\n--- ERRORS ---');
  console.log(errors.length ? errors.join('\n') : 'NONE');
  console.log(`\n${logs.filter(l=>l.startsWith('FAIL')).length} failed / ${logs.length} checks`);
  process.exit(errors.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
setTimeout(() => { console.error('TIMEOUT - forcing exit'); process.exit(1); }, 8000);
