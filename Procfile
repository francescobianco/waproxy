web: docker compose up waproxy
release: if [ ! -f .env ]; then echo "WAPROXY_PASSWORD=$(shell openssl rand -hex 32)" > .env; fi; cat .env
