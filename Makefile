
push:
	@git add .
	@git commit -am "update" || true
	@git push

build:
	@docker build -t yafb/waproxy .

start: build
	@echo "Starting waproxy..."
	@docker run -it --init --rm -e WAPROXY_PASSWORD=Secret1234! -v $${PWD}/tmp:/var/waproxy/data -p 3000:3000 yafb/waproxy

test-send:
	@curl -v -u wa:Secret1234! localhost:3000/send?to=393200466987 -d "c  iaocome asdasd stai"
