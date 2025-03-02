web: docker compose up --build --force-recreate --remove-orphans
release: [ ! -f .env ]; then echo "WAPROXY_PASSWORD=$(openssl rand -hex 32)" > .env || true
