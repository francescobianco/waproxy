
start:
	@docker build -t wbmserver .
	@docker run -it --init -v $${PWD}/tmp:/var/wbm/data -p 3000:3000 wbmserver

test-send:
	@curl -X POST -H "Content-Type: application/json" -d '{"message": "Hello World"}' http://localhost:3000/send