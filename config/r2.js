// config/r2.js
// Cloudflare R2 client setup.
//
// R2 is S3-compatible, so we use the AWS SDK v3 with a custom
// endpoint. These credentials NEVER leave the server, the
// browser never talks to R2 directly.
// Author: Brandon Calvario

const { S3Client } = require("@aws-sdk/client-s3");
require("dotenv").config();
const r2Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});
module.exports = {
    r2Client,
    BUCKET_NAME: process.env.R2_BUCKET_NAME,
};
