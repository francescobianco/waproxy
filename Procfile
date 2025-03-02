web: echo "A" && docker compose up waproxy
release: [ ! -f .env ] && echo "WAPROXY_PASSWORD=$(openssl rand -hex 32)" > .env
#release: docker compose up -d --build --force-recreate --remove-orphans
