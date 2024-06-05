
build:
	@docker build -t waproxy .

start: build
	@docker run -it --init -v $${PWD}/tmp:/var/waproxy/data -p 3000:3000 waproxy

test-send:
	@curl localhost:3000/send?to=393200466987 -d "c  iaocomestai"