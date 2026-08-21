# Domestic deployment

Deploy only this directory to `/opt/used-market-domestic`. The app publishes `127.0.0.1:8789` and owns `used-market-domestic_results`.

```bash
sudo bash deploy/update.sh /path/to/domestic
curl -fsS http://127.0.0.1:8789/health
curl -I http://127.0.0.1:8789/
```

Host Nginx routes `/` and `/api/*` here. Never mount or import the global app directory, its result volume, or its release path.
