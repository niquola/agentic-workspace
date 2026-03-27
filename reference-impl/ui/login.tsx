// Claude login prompt — shown when Claude is not authenticated in a workspace

export function ClaudeLoginPrompt({ wsName, namespace }: { wsName: string; namespace: string }): string {
  const api = `/apis/v1/namespaces/${namespace}/workspaces/${encodeURIComponent(wsName)}`;

  return (
    <div id="claude-login-flow" class="px-3 py-3">
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <i class="fa-solid fa-circle-info text-amber-500 mt-0.5"></i>
          <div class="flex-1">
            <h4 class="text-sm font-semibold text-amber-800 mb-1">Claude not authenticated</h4>
            <p class="text-xs text-amber-700 mb-3">
              Claude needs to be logged in before you can create topics. Click below to start the login flow.
            </p>

            <div id="login-step-start">
              <button id="btn-start-login" type="button"
                class="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded cursor-pointer transition">
                <i class="fa-solid fa-play text-[10px] mr-1"></i> Start Login
              </button>
            </div>

            <div id="login-step-url" class="hidden">
              <p class="text-xs text-gray-600 mb-2">Open this link in your browser to log in:</p>
              <div class="bg-white border rounded p-2 mb-2">
                <a id="login-url" href="#" target="_blank" class="text-xs text-indigo-600 underline break-all"></a>
              </div>
              <div class="flex items-center gap-2">
                <span class="spinner"></span>
                <span class="text-xs text-gray-500">Waiting for authorization...</span>
              </div>
            </div>

            <div id="login-step-done" class="hidden">
              <div class="flex items-center gap-2 text-green-700">
                <i class="fa-solid fa-circle-info text-green-500"></i>
                <span class="text-xs font-medium">Claude authenticated! You can now create topics.</span>
              </div>
            </div>

            <div id="login-step-error" class="hidden">
              <p class="text-xs text-red-600" id="login-error-msg"></p>
              <button id="btn-retry-login" type="button"
                class="text-xs text-amber-600 underline mt-1 cursor-pointer">Try again</button>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var api = ${JSON.stringify(api)};
  var token = (document.cookie.match(/ws-token=([^;]+)/)||[])[1]||'';
  var headers = token ? { Authorization: 'Bearer ' + token } : {};

  var stepStart = document.getElementById('login-step-start');
  var stepUrl = document.getElementById('login-step-url');
  var stepDone = document.getElementById('login-step-done');
  var stepError = document.getElementById('login-step-error');
  var loginUrlEl = document.getElementById('login-url');
  var errorMsg = document.getElementById('login-error-msg');

  function showStep(step) {
    stepStart.className = step === 'start' ? '' : 'hidden';
    stepUrl.className = step === 'url' ? '' : 'hidden';
    stepDone.className = step === 'done' ? '' : 'hidden';
    stepError.className = step === 'error' ? '' : 'hidden';
  }

  function startLogin() {
    showStep('url');
    loginUrlEl.textContent = 'Starting...';
    loginUrlEl.href = '#';

    fetch(api + '/auth/login', { method: 'POST', headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (j.loginUrl) {
          loginUrlEl.textContent = j.loginUrl;
          loginUrlEl.href = j.loginUrl;
          pollAuth();
        } else {
          errorMsg.textContent = j.error || j.stderr || 'Failed to start login';
          showStep('error');
        }
      })
      .catch(function(e) {
        errorMsg.textContent = e.message;
        showStep('error');
      });
  }

  function pollAuth() {
    var poll = setInterval(function() {
      fetch(api + '/auth/status', { headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(s) {
          if (s.authenticated) {
            clearInterval(poll);
            showStep('done');
          }
        });
    }, 3000);
  }

  document.getElementById('btn-start-login').onclick = startLogin;
  document.getElementById('btn-retry-login').onclick = function() {
    showStep('start');
  };
})();
      `}} />
    </div>
  );
}
