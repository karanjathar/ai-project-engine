# StockSync — Deployment Guide (Microsoft Azure)

```
GitHub (push to main) ──► Actions: lint · type-check · tests (PostgreSQL) · build · Bicep validate
                               └──► OIDC login ─► docker build ─► Azure Container Registry ─► Container Apps revision ─► /healthz smoke test

Azure resource group
 ├─ Container Apps environment ─ stocksync-app (API + web + shop, HTTPS ingress, probes on /healthz)
 │     └─ user-assigned managed identity ──► AcrPull on ACR · Key Vault Secrets User on Key Vault
 ├─ Azure Database for PostgreSQL Flexible Server 16 (TLS required)
 ├─ Storage account ─ blob container "product-images" (public read, CORS for direct browser upload)
 ├─ Key Vault (RBAC, soft delete, purge protection) ─ every runtime secret
 └─ Log Analytics + Application Insights (requests, dependencies, exceptions, live metrics)
```

> The spec template suggested a single `DEPLOY_CREDENTIALS` GitHub secret. This pipeline uses **OIDC workload identity federation** instead. GitHub gets a short-lived Azure token per run, so no long-lived cloud credentials sit in GitHub. `DATABASE_URL`, `PORT` and the other runtime settings live in **Key Vault / the Container App**, never in GitHub.

---

## 1. Prerequisites
- Azure subscription where you can create resources and role assignments (Owner, or Contributor + User Access Administrator)
- Azure CLI ≥ 2.60 (`az bicep install`), and a GitHub repository containing this project
- Bash (the commands below; on Windows use WSL or Git Bash)

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.OperationalInsights
```

## 2. One-time provisioning

### 2.1 Choose names and generate secrets
```bash
export RG=stocksync-prod
export LOCATION=centralindia            # any region with Container Apps + PostgreSQL Flexible Server
export ADMIN_EMAIL=you@yourcompany.com
export PG_PASSWORD="$(openssl rand -base64 24)"
export JWT_SECRET="$(openssl rand -base64 48)"
export ADMIN_PASSWORD="$(openssl rand -base64 18)"
echo "First login password: $ADMIN_PASSWORD"    # store it in your password manager
az group create -n "$RG" -l "$LOCATION"
```

### 2.2 Phase 1: infrastructure (no app yet)
```bash
az deployment group create -g "$RG" -f infra/main.bicep \
  -p deployApp=false adminEmail="$ADMIN_EMAIL" \
     postgresAdminPassword="$PG_PASSWORD" jwtSecret="$JWT_SECRET" adminPassword="$ADMIN_PASSWORD"

export ACR_NAME=$(az deployment group show -g "$RG" -n main --query properties.outputs.acrName.value -o tsv)
```

### 2.3 First image (built inside Azure, no local Docker needed)
```bash
az acr build -r "$ACR_NAME" -t stocksync:initial .
```

### 2.4 Phase 2: create the Container App
Re-run the same deployment with the app enabled. Re-running is safe: Bicep deployments are idempotent.
```bash
az deployment group create -g "$RG" -f infra/main.bicep \
  -p deployApp=true imageTag=stocksync:initial adminEmail="$ADMIN_EMAIL" \
     postgresAdminPassword="$PG_PASSWORD" jwtSecret="$JWT_SECRET" adminPassword="$ADMIN_PASSWORD"

export APP_URL=$(az deployment group show -g "$RG" -n main --query properties.outputs.appUrl.value -o tsv)
echo "$APP_URL"
```
On first start the app runs database migrations, creates the admin user and ensures the blob container exists.

## 3. Health check verification
```bash
curl -fsS "$APP_URL/healthz"            # → {"status":"ok","db":"ok"}
curl -fsS "$APP_URL/api/public/catalog" # → {"settings":{...},"products":[]}
```
Then in a browser:
1. Open `$APP_URL`, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then go to **My account → Change password** (top right).
2. **Warehouses** → create e.g. `MAIN`. **Settings** → set it as the default warehouse, plus business name, currency and WhatsApp number.
3. **Products** → add a product with an image (this checks Blob upload). **Inventory** → Receive stock.
4. Open `$APP_URL/shop` and confirm the product, its image and the cart work.
5. On a phone, open `$APP_URL` and choose **Add to Home Screen** to install the PWA.

## 4. CI/CD: GitHub Actions with OIDC
### 4.1 Create the deploy identity
```bash
export GH_REPO="<github-owner>/<repo>"
APP_ID=$(az ad app create --display-name "stocksync-github-deploy" --query appId -o tsv)
az ad sp create --id "$APP_ID" >/dev/null
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-production\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${GH_REPO}:environment:production\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"
# Least privilege: push images, and update this resource group's Container App.
az role assignment create --assignee "$APP_ID" --role AcrPush \
  --scope "$(az acr show -n "$ACR_NAME" --query id -o tsv)"
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "$(az containerapp show -n stocksync-app -g "$RG" --query id -o tsv)"
```

### 4.2 Configure the GitHub repository
Settings → Environments → create **`production`** (optionally add required reviewers for manual approval). Then add:

| Kind | Name | Value |
|---|---|---|
| Secret | `AZURE_CLIENT_ID` | `$APP_ID` |
| Secret | `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| Secret | `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| Variable | `ACR_NAME` | `$ACR_NAME` |
| Variable | `CONTAINER_APP_NAME` | `stocksync-app` |
| Variable | `AZURE_RESOURCE_GROUP` | `$RG` |

Every push to `main` now runs **lint → type-check → tests (against PostgreSQL) → build → Bicep validation**, then builds the image, pushes `stocksync:<sha>`, rolls out a new revision and smoke-tests `/healthz`. Pull requests run the test job only.

## 5. Connecting WhatsApp, Messenger, Instagram & Telegram
All webhooks are served by the app itself:

| Platform | Webhook URL | Auth |
|---|---|---|
| WhatsApp, Messenger, Instagram | `$APP_URL/webhooks/meta` | Verify token (handshake) + `X-Hub-Signature-256` HMAC with the app secret |
| Telegram | `$APP_URL/webhooks/telegram` | `X-Telegram-Bot-Api-Secret-Token` header |

### 5.1 Meta (one app covers all three)
1. In [developers.facebook.com](https://developers.facebook.com), create an app of type **Business** and note the **App secret** (App settings → Basic).
2. Pick a random **verify token**: `openssl rand -hex 16`.
3. **WhatsApp:** add the *WhatsApp* product, then note the **Phone number ID**. Create a **System User** in Business Settings with a **permanent access token** that has `whatsapp_business_messaging`. Under WhatsApp → Configuration → Webhook, enter the callback URL above and your verify token, then subscribe to **messages**.
4. **Messenger:** add *Messenger*, link your Facebook Page, generate a **Page access token**, set the same webhook and subscribe the page to **messages**.
5. **Instagram:** connect an Instagram **professional** account to the Page, add *Instagram* messaging, use a Page token with `instagram_manage_messages`, and subscribe to **messages**.

### 5.2 Telegram
1. Talk to **@BotFather** → `/newbot` → copy the bot token.
2. Pick a webhook secret: `openssl rand -hex 24` (letters, digits, `_` and `-` only).

### 5.3 Store the channel secrets and redeploy
Create `infra/channels.secrets.json`. It is git-ignored, so never commit it. Include only the channels you use:
```json
{
  "META_APP_SECRET": "…",
  "META_VERIFY_TOKEN": "…",
  "WHATSAPP_TOKEN": "…",
  "MESSENGER_PAGE_TOKEN": "…",
  "INSTAGRAM_PAGE_TOKEN": "…",
  "TELEGRAM_BOT_TOKEN": "…",
  "TELEGRAM_WEBHOOK_SECRET": "…"
}
```
```bash
az deployment group create -g "$RG" -f infra/main.bicep \
  -p deployApp=true imageTag=stocksync:latest adminEmail="$ADMIN_EMAIL" \
     postgresAdminPassword="$PG_PASSWORD" jwtSecret="$JWT_SECRET" adminPassword="$ADMIN_PASSWORD" \
     whatsappPhoneNumberId="<PHONE_NUMBER_ID>" channelSecrets=@infra/channels.secrets.json

# Telegram: register the webhook (the Meta webhooks are registered in the Meta dashboard)
curl -fsS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=$APP_URL/webhooks/telegram" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
The secrets go to Key Vault, and the app reads them through its managed identity. **Settings → Messaging channels** turns green for each configured channel.

### 5.4 Test it
Send `help`, `catalog`, `stock <SKU>`, `price <SKU>`, `order <SKU> 2` and `status <n>` to your WhatsApp number or bot. Orders appear live on the dashboard and in **Orders**, and chats appear in **Inbox**. In **Settings → Low-stock alert recipients**, add your own WhatsApp number or Telegram chat id. Get the chat id from the Inbox after you message the bot.

> **WhatsApp 24-hour rule:** WhatsApp only delivers free-form messages (alerts, order updates) to people who messaged your number in the last 24 hours. Customers who just ordered are always inside the window. For staff alerts, either message the bot daily or register approved Meta message templates.

## 6. Local development
```bash
cp .env.example .env               # fill in values; .env is git-ignored
docker compose up --build          # app + PostgreSQL + Azurite (Blob emulator) → http://localhost:3005 (override with APP_PORT=…)
```
Or without Docker: run PostgreSQL locally, then `npm install && npm run dev` (API on :8080, Vite on :5173 with proxy).
Quality gate (same as CI): `npm run typecheck && npm run lint && npm test`. Tests need PostgreSQL at `TEST_DATABASE_URL` (default `postgres://postgres@localhost:5432/inventory_test`).

To test webhooks from a laptop, expose port 8080 with a tunnel (e.g. `devtunnel host -p 8080 --allow-anonymous` or ngrok) and use that HTTPS URL in Meta and Telegram.

## 7. Operations
| Task | How |
|---|---|
| Live logs | `az containerapp logs show -n stocksync-app -g $RG --follow` |
| Metrics, traces, failures | Azure Portal → Application Insights `stocksync-ai-*` |
| Roll back | `az containerapp update -n stocksync-app -g $RG --image $ACR_NAME.azurecr.io/stocksync:<previous-sha>` |
| Rotate a secret | `az keyvault secret set --vault-name <kv> -n jwt-secret --value …` then `az containerapp revision restart …` |
| Database backups | Automatic, 7-day point-in-time restore (raise in Bicep `backupRetentionDays`) |
| Scale | Single replica by design (in-process realtime bus). Add Azure Web PubSub before raising `maxReplicas` |
| Harden networking | Move PostgreSQL to VNet integration / private endpoint and drop the `AllowAzureServices` firewall rule |

Security posture and accepted risks: see `docs/7_SECURITY_AUDIT.md`.
