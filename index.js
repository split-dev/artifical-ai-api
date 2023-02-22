import express from 'express';
import * as dotenv from 'dotenv';

console.log('process.env', process.env);
dotenv.config();
console.log('process.env 2', process.env);

import cors from 'cors';
import bodyParser from 'body-parser';

import { promptGenerate, allPromptsGenerate, promptDiffusion } from './util/prompt-handler';
import { combineTShirtImage, resizeImage } from './util/image-handler';
import { imagesCollection } from './util/db';
import { read } from './util/filestorage';

const api = express();

api.use(cors());
api.use(bodyParser.json());

api.get('/', async (req, res) => {
  res.send('<h1>Hello!</h1>');
});


api.post('/prompt', async (req, res) => {
  let prompts;

  if (req.body.fullPrompt) {
    prompts = [req.body.fullPrompt];
  } else if (req.body.prompt) {
    prompts = await promptGenerate(req.body.prompt);
  } else {
    res.statusCode = 500;
    res.end(JSON.stringify({ detail: 'Prompt param not provided!' }));

    return;
  }
  
  const result = [];

  for (let i = 0; i < prompts.length; i++) {
    const response = await promptDiffusion(prompts[i]);
  
    if (response.status !== 201) {
      let error = await response.json();

      res.statusCode = 500;
      res.end(JSON.stringify({ detail: error.detail }));

      return;
    }

    const successRes = await response.json();
  
    await imagesCollection.insertOne({
      requestId: successRes.id,
      initialPrompt: req.body.prompt,
      prompt: prompts[i]
    });

    result.push(successRes);
  }

  console.log('Send prompt result :>> ', result);

  res.statusCode = 201;
  res.end(JSON.stringify(result));
});

api.post('/webhook-diffusion', async (req, res) => {
  const resultImages = {};

  if (req.body?.id) {
    resultImages.prompt = req.body.input.prompt;
    resultImages.requestId = req.body.id;
    resultImages.images = {};

    if (req.body.output?.length) {
      for (let i = 0; i < req.body.output.length; i++) {
        const imgUrl = req.body.output[i];
        const resizeRes = await resizeImage(imgUrl);
        const combinedRes = await combineTShirtImage(imgUrl, req.body.id);
  
        if (resizeRes.id) {
          resultImages.images[resizeRes.id] = combinedRes;
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: 'There is an error in Diffusion Resize: output is empty. Images did not generated' }));
  
          return;
        }
      }
  
      console.log('Got diffusion', resultImages);  
    } else {
      if (req.body.error) {
        resultImages.error = req.body.error;
      }
    }

    const insertResult = await imagesCollection.updateOne({
      prompt: resultImages.prompt,
      requestId: resultImages.requestId
    }, { $set: resultImages }, { upsert: true });

    res.status(200).send(insertResult);
  }
});

api.post('/webhook-scale', async (req, res) => {
  if (req.body?.output) {
    const resizeId = req.body.id;
    const updateResult = await imagesCollection.updateOne(
      {
        [`images.${resizeId}`]: { $exists: true }
      },
      { 
        $set: { [`images.${resizeId}.imageFull`]: req.body.output }
      }
    );

    res.status(200).send(updateResult);
  } else {
    res.statusCode = 500;
    res.end(JSON.stringify({ detail: 'There is an error in Scale: output is empty. Images did not generated' }));
  }
});


api.get('/image', async (req, res) => {  
  let result;
  
  if (req.query.requestId) {
    result = await imagesCollection.find({ requestId: { $in: req.query.requestId.split(',') }, images: { $ne: null } }).toArray();
  } else if (req.query.imageId) {
    result = await imagesCollection.find({ [`images.${req.query.imageId}`]: { $exists: true } }).toArray();
  } else if (req.query.prompt) {
    result = await imagesCollection.find({ prompt: `/.*${req.query.prompt}.*/i`, images: { $ne: null } }).toArray();
  } else {
    res.statusCode = 500;
    res.end(JSON.stringify({ detail: 'Request should contain requestId or prompt field' }));
  }

  res.status(200).send(result);
});


api.get('/last-images', async (req, res) => {  
  const length = req.query.length? parseInt(req.query.length, 10) : 10;
  let result;
  
  result = await imagesCollection.find({}).limit(length).sort({_id: -1}).toArray();

  res.status(200).send(result);
});

api.get('/available-prompts', async (req, res) => {
  if (req.query.prompt) {
    const prompts = await allPromptsGenerate(req.query.prompt);

    res.statusCode = 200;
    res.end(JSON.stringify(prompts));
  } else {
    res.statusCode = 500;
    res.end(JSON.stringify({ detail: 'No prompts provided!' }));
  }
});

api.get('/prompt', async (req, res) => {
  const response = await fetch(
    'https://api.replicate.com/v1/predictions/' + req.query.id,
    {
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.status !== 200) {
    let error = await response.json();

    res.statusCode = 500;
    res.end(JSON.stringify({ detail: error.detail }));

    return;
  }

  const prediction = await response.json();

  res.end(JSON.stringify(prediction));
});

api.get('/images/:image', async (req, res) => {
    const { image } = req.params;

    if (!image) {
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: 'No image name provided!' }));
    } else {
      const fileResult = await read(image);

      if (fileResult.error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ detail: fileResult.error }));
      } else {
        res.statusCode = 200;
        res.set('Content-type', fileResult.ContentType);
        res.send(fileResult.Body.toString()).end();
      }
    }
});