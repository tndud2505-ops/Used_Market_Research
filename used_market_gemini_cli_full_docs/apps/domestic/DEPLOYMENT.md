# Domestic deployment

Deploy only this directory to `/opt/used-market-domestic`. The app publishes `127.0.0.1:8789` and owns `used-market-domestic_results`.

```bash
sudo bash deploy/update.sh /path/to/domestic
curl -fsS http://127.0.0.1:8789/health
curl -I http://127.0.0.1:8789/
```

Host Nginx routes `/` and `/api/*` here. Store eBay credentials only in the protected runtime environment; never bake them into the image or repository.
