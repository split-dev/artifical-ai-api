import { S3 } from 'aws-sdk';

const storage = new S3();

export const write = async (filename, buffer) => {
    await storage.putObject({
        Body: buffer,
        Bucket: process.env.BUCKET,
        ACL: 'public-read',
        ContentType: 'image/png',
        Key: filename,
      }).promise();

      return filename;
};

export const read = async (filename) => {
    try {
        let s3File = await storage.getObject({
          Bucket: process.env.BUCKET,
          Key: filename,
        }).promise();
    
        return Buffer.from(s3File.Body); 
      } catch (error) {
        return { error };
      }
};