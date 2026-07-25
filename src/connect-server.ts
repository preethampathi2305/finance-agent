import express from "express";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { createLinkToken } from "./finance/plaid-data.js";
import { saveItemFromPublicToken } from "./store/items.js";

// Ensure DB exists before handling Link callbacks.
getDb();

const app = express();
app.use(express.json());

function connectPageHtml(opts: { oauthReturn: boolean; env: string }) {
  const envLabel =
    opts.env === "sandbox"
      ? "Sandbox (fake banks)"
      : opts.env === "development"
        ? "Development (legacy)"
        : "Production / live banks";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Finance Agent — Connect accounts</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: radial-gradient(circle at top left, #d9efe8, #f7f3ea 55%, #e8eef6);
      color: #1c2430;
    }
    main { width: min(440px, 92vw); text-align: center; }
    h1 { font-size: 2rem; font-weight: 600; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
    p { margin: 0 0 1rem; line-height: 1.45; color: #425066; }
    .env {
      display: inline-block; margin-bottom: 1.25rem; padding: 0.35rem 0.75rem;
      border-radius: 999px; background: #163a2e; color: #f4faf7; font-size: 0.85rem;
    }
    button {
      appearance: none; border: 0; cursor: pointer;
      background: #163a2e; color: #f4faf7; padding: 0.9rem 1.4rem;
      font: inherit; font-size: 1rem; border-radius: 999px;
    }
    button:disabled { opacity: 0.6; cursor: wait; }
    #status { margin-top: 1rem; min-height: 1.4em; font-size: 0.95rem; color: #163a2e; }
  </style>
</head>
<body>
  <main>
    <h1>Finance Agent</h1>
    <div class="env">${envLabel}</div>
    <p>Connect a US bank or credit card. OAuth banks return here after login.</p>
    <button id="connect"${opts.oauthReturn ? " disabled" : ""}>Connect with Plaid</button>
    <div id="status">${opts.oauthReturn ? "Finishing OAuth…" : ""}</div>
  </main>
  <script>
    const status = document.getElementById('status');
    const button = document.getElementById('connect');
    const isOAuthReturn = ${opts.oauthReturn ? "true" : "false"};

    async function exchangePublicToken(public_token, metadata) {
      status.textContent = 'Saving connection…';
      const saveRes = await fetch('/api/exchange-public-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token, metadata }),
      });
      const body = await saveRes.json();
      if (!saveRes.ok) throw new Error(body.error || 'Exchange failed');
      status.textContent = 'Connected: ' + (body.institution_name || body.item_id) +
        ' (' + body.accounts.length + ' accounts). You can close this tab.';
      button.disabled = false;
    }

    function openLink(link_token, receivedRedirectUri) {
      const handler = Plaid.create({
        token: link_token,
        ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
        onSuccess: async (public_token, metadata) => {
          try {
            await exchangePublicToken(public_token, metadata);
            sessionStorage.removeItem('plaid_link_token');
          } catch (err) {
            status.textContent = err.message || String(err);
            button.disabled = false;
          }
        },
        onExit: (err) => {
          button.disabled = false;
          status.textContent = err
            ? ('Exited: ' + (err.display_message || err.error_message || 'unknown error'))
            : 'Closed.';
        },
      });
      handler.open();
    }

    async function startLink() {
      button.disabled = true;
      status.textContent = 'Starting Plaid Link…';
      const tokenRes = await fetch('/api/create-link-token', { method: 'POST' });
      const body = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(body.error || 'Could not create link token');
      sessionStorage.setItem('plaid_link_token', body.link_token);
      openLink(body.link_token);
    }

    button.addEventListener('click', async () => {
      try {
        await startLink();
      } catch (err) {
        button.disabled = false;
        status.textContent = err.message || String(err);
      }
    });

    if (isOAuthReturn) {
      (async () => {
        try {
          const link_token = sessionStorage.getItem('plaid_link_token');
          if (!link_token) {
            throw new Error('Missing link token after OAuth. Click Connect and try again.');
          }
          openLink(link_token, window.location.href);
        } catch (err) {
          button.disabled = false;
          status.textContent = err.message || String(err);
        }
      })();
    }
  </script>
</body>
</html>`;
}

app.get("/", (_req, res) => {
  res.type("html").send(
    connectPageHtml({ oauthReturn: false, env: config.plaidEnv() }),
  );
});

// OAuth banks redirect here after login; same page re-opens Link with receivedRedirectUri.
app.get("/oauth", (_req, res) => {
  res.type("html").send(
    connectPageHtml({ oauthReturn: true, env: config.plaidEnv() }),
  );
});

app.get("/api/status", (_req, res) => {
  res.json({
    plaid_env: config.plaidEnv(),
    redirect_uri: config.plaidRedirectUri() ?? null,
    database_path: config.databasePath(),
  });
});

app.post("/api/create-link-token", async (_req, res) => {
  try {
    const link_token = await createLinkToken();
    res.json({
      link_token,
      plaid_env: config.plaidEnv(),
      redirect_uri: config.plaidRedirectUri() ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const plaidError =
      error && typeof error === "object" && "response" in error
        ? (error as { response?: { data?: unknown } }).response?.data
        : undefined;
    res.status(500).json({
      error: message,
      plaid: plaidError ?? null,
    });
  }
});

app.post("/api/exchange-public-token", async (req, res) => {
  try {
    const publicToken = req.body?.public_token as string | undefined;
    if (!publicToken) {
      res.status(400).json({ error: "public_token is required" });
      return;
    }
    const saved = await saveItemFromPublicToken(publicToken);
    res.json({
      item_id: saved.itemId,
      institution_name: saved.institutionName,
      accounts: saved.accounts,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const port = config.connectPort();
app.listen(port, () => {
  console.log(`Connect accounts at http://localhost:${port}`);
  console.log(`Plaid env: ${config.plaidEnv()}`);
  console.log(`Database: ${config.databasePath()}`);
  const redirect = config.plaidRedirectUri();
  if (redirect) {
    console.log(`OAuth redirect: ${redirect}`);
  } else {
    console.log(
      "OAuth redirect: not set (fine for some banks; Chase/Amex/etc need PLAID_REDIRECT_URI)",
    );
  }
});
