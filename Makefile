.PHONY: install build test typecheck http deploy restart

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

deploy:
	bash deploy/vps/deploy.sh

restart:
	bash deploy/vps/restart-services.sh
