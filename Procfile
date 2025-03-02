web: echo "A" && docker compose up waproxy
release: echo "B" && docker compose ps && \
		 docker compose up -d --build --force-recreate --remove-orphans
