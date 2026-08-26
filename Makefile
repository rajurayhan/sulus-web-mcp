.PHONY: install build test typecheck http docker-up docker-down deploy restart

install:
	npm install
	npx playwright install chromium

build:
	npm run build

test:
	npm test

typecheck:
	npm run typecheck

http:
	npm run start:http

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

deploy:
	bash deploy/vps/deploy.sh

restart:
	bash deploy/vps/restart-services.sh
