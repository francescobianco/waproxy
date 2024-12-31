web: docker compose up waproxy
release: rm -f .env && make .env && docker compose up -d --build --force-recreate --remove-orphans
