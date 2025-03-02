web: echo "A" && docker compose up waproxy
release: if [ ! -f .env ]; then echo "WAPROXY_PASSWORD=$(openssl rand -hex 32)" > .env fi && \
		 docker compose up -d --build --force-recreate --remove-orphans
