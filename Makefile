
start:
	@docker build -t wbmserver .
	@docker run -v $${PWD}/tmp:/var/wbm/data wbmserver

test-send:
	@curl -X POST -H "Content-Type: application/json" -d '{"message": "Hello World"}' http://localhost:3000/send