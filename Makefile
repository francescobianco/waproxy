
.env:
	@echo "WAPROXY_PASSWORD=$(shell openssl rand -hex 32)" > .env
	@echo "WAPROXY_ADMIN=393200466987" >> .env
	@echo "OPENROUTER_API_KEY=" >> .env

push:
	@git add .
	@git commit -am "update" || true
	@git push

build:
	@docker build -t yafb/waproxy .

start: build
	@echo "Starting waproxy..."
	@docker run -it --init --rm \
		-e WAPROXY_PASSWORD=Secret1234! \
		-e WAPROXY_ADMIN=393200466987 \
		-e OPENROUTER_API_KEY=$${OPENROUTER_API_KEY} \
		-v $${PWD}/tmp:/var/waproxy/data \
		-p 3025:3025 yafb/waproxy

test-send:
	@curl -v -u wa:Secret1234! localhost:3000/send?to=393200466987 -d "c  iaocome asdasd stai"

test-remote:
	@curl -v -u wa:$(WAPROXY_PASSWORD) https://wa.yafb.net/send?to=393200466987 -d "c  iaocome asdasd stai"