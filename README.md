# Solar Horse

Solar Horse is a private crypto and macro dashboard.

## Run Locally

```powershell
npm start
```

Open `http://localhost:4173`.

## Private Password

Set `APP_PASSWORD` in production to require a password before opening the app.

```powershell
$env:APP_PASSWORD="your-password"
npm start
```

Do not commit real passwords to GitHub. Use Render environment variables instead.

## Optional API Keys

```powershell
$env:BITBO_API_KEY="..."
npm start
```
