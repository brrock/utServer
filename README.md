# utServer - The **unoffical** way to self host **uploadthing**, lightning fast

Running out of storage in uploadthing? Don't want to pay for more storage for testing? Then this is the perfect tool for you. All you need is bun and you have a quick uploadthing server, that works with the official client - out of the box, almost completely compat. We are fully compatiable with the openAPi spec. 

## How to run

The steps are easy, they are just a few things you have to do before you get started - these only need to be done once too

1. Install bun
2. Clone the repo and install deps

```sh
git clone https://github.com/brrock/utserver
cd utserver
bun i
```

3. Copy .env.example to .env and edit the env variables, change the api key, base url, app id (this doesn't matter too much - just call it your app name) if you want and port if you want
4. Generate uploadthing token, because uploadthing base64s it along some config it needs

```sh
bun bun genUtAPIKey.ts
```

5. Add these to the app that uses uploadthing that you want to connect to your self hosted version - ensure you are running the latest uploadthing (this is **very** important, if you even want to try older versions, this requires uploadthing 7.7.3 - the core package )

```dotenv
UPLOADTHING_INGEST_URL="[yourbaseurl]"
UPLOADTHING_API_URL="[yourbaseurl]"
UPLOADTHING_UTFS_HOST="[yourbaseurlwithouthttporhttps]"
UPLOADTHING_UFS_HOST="[yourbaseurlwithouthttporhttps]"
UPLOADTHING_UFS_APP_ID_LOCATION=path # this is required
UPLOADTHING_TOKEN={theoneyougeneratedinstep4}
```
6. Init the DB - sqlite at the moment
```sh
bun prisma db:push
``` 
7. Run the server

```sh
bun start
# running in debug 
DEBUG=1 bun start
```
## FAQ
- Is this allowed by UploadThing
**yes**, it is an allowed, the maintainers have consented
- What clients do this support
Just the **js** one is confirmed to work, if you want your client to work make a PR or github issue
## RoadMap
- LTS version for multiple ut versions (maintainers wanted)
- UploadThing tests
- S3 storage adapter 
- Vercel blob storage adapter
