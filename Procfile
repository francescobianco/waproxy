web: docker compose up waproxy
release: if [ ! -f .env ]; then echo "WAPROXY_PASSWORD=$(openssl rand -hex 32)" > .env; fi
release: docker compose down; sleep 5; docker compose up -d --build --force-recreate --remove-orphans
