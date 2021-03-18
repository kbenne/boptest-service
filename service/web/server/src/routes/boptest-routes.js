import express from 'express';
import got from 'got'
import {getResults} from '../controllers/result';
import {getKPIs} from '../controllers/kpi';
import {getInputs} from '../controllers/input';
import {getMeasurements} from '../controllers/measurement';
import {getStep, setStep} from '../controllers/step';
import {initialize, advance} from '../controllers/test';
const boptestRoutes = express.Router();


// Post a query to the graphql api
const graphqlPost = async (querystring, baseurl) => {
  const {body} = await got.post( baseurl + '/graphql', {
    json: {
      query: querystring
    }
  });
  return body;
};

const graphqlPostAndRespond = (querystring, req, res, next) => {
  const baseurl = baseurlFromReq(req);
  graphqlPost(querystring, baseurl).then((body) => res.send(body)).catch((e) => next(e));
};

const promiseTaskLater = (task, time, ...args) => {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        await task(...args);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, time);
  });
};

const simStatus = async (id, baseurl) => {
  try {
    const querystring = `{ viewer{ sites(siteRef: "${id}") { simStatus } } }`;
    const body = await graphqlPost(querystring, baseurl);
    return JSON.parse(body)["data"]["viewer"]["sites"][0]["simStatus"];
  } catch (e) {
    console.log("Error retriving sim status");
    throw(e);
  }
};

const waitForSimStatus = async (id, baseurl, desiredStatus, count, maxCount) => {
  let i = 0;
  const currentStatus = await simStatus(id, baseurl);
  if (currentStatus == desiredStatus) {
    return;
  } else if (count == maxCount) {
    throw(`Timeout waiting for sim: ${id} to reach status: ${desiredStatus}`);
  } else {
    await promiseTaskLater(waitForSimStatus, 2000, id, baseurl, desiredStatus, count, maxCount);
  }
};

boptestRoutes.post('/advance/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis')
    const advancer = req.app.get('advancer')
    const u = req.body
    const y = await advance(req.params.id, redis, advancer, u)
    res.send(y)
  } catch (e) {
    next(e)
  }
});

boptestRoutes.put('/initialize/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis')
    const sqs = req.app.get('sqs')
    const start_time = req.body['start_time']
    const warmup_period = req.body['warmup_period']
    const y = await initialize(req.params.id, start_time, warmup_period, redis, sqs)
    res.send(y)
  } catch (e) {
    next(e)
  }
});

boptestRoutes.put('/stop/:id', async (req, res, next) => {
  try {
    const querystring = `mutation{
      stopSite(
        siteRef: "${req.params.id}"
      )
    }`;

    const baseurl = baseurlFromReq(req);
    await graphqlPost(querystring, baseurl);
    await waitForSimStatus(req.params.id, baseurl, "Stopped", 0, 3);
    res.end();
  } catch (e) {
    next(e);
  }
});

boptestRoutes.get('/measurements/:id', async (req, res, next) => {
  try {
    const db = req.app.get('db');
    const measurements = await getMeasurements(req.params.id, db)
    res.send(measurements)
  } catch (e) {
    next(e)
  }
});

boptestRoutes.get('/inputs/:id', async (req, res, next) => {
  try {
    const db = req.app.get('db');
    const inputs = await getInputs(req.params.id, db)
    res.send(inputs)
  } catch (e) {
    next(e)
  }
})

boptestRoutes.get('/step/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis')
    const db = req.app.get('db')
    const step = await getStep(req.params.id, db, redis)
    res.send(step.toString())
  } catch (e) {
    next(e)
  }
})

boptestRoutes.put('/step/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis')
    const db = req.app.get('db')
    const step = req.body['step']
    await setStep(req.params.id, step, db, redis)
    res.sendStatus(200)
  } catch (e) {
    next(e)
  }
});

boptestRoutes.get('/kpi/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis');
    const id = req.params.id
    const kpis = await getKPIs(id, redis)
    res.send(kpis)
  } catch (e) {
    next(e);
  }
});

boptestRoutes.put('/results/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis');
    const id = req.params.id
    const point_name = req.body['point_name']
    const start_time = req.body['start_time']
    const final_time = req.body['final_time']
    const results = await getResults(id, point_name, start_time, final_time, redis)
    res.send(results)
  } catch (e) {
    next(e);
  }
});

boptestRoutes.get('/forecast_parameters/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis');
    redis.hmget(req.params.id, 'forecast:horizon', 'forecast:interval', (err, redisres) => {
      if (err) {
        next(err);
      } else {
        res.send(redisres);
      }
    });
  } catch (e) {
    next(e);
  }
});

boptestRoutes.put('/forecast_parameters/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis');
    const horizon = req.body['horizon'];
    const interval = req.body['interval'];
    redis.hmset(req.params.id, 'forecast:horizon', horizon, 'forecast:interval', interval, (err) => {
      if (err) {
        next(err);
      } else {
        res.end();
      }
    });
  } catch (e) {
    next(e);
  }
});

boptestRoutes.get('/forecast/:id', async (req, res, next) => {
  try {
    const redis = req.app.get('redis');
    redis.hget(req.params.id, 'forecast', (err, redisres) => {
      if (err) {
        next(err);
      } else {
        res.send(redisres);
      }
    });
  } catch (e) {
    next(e);
  }
});

export default boptestRoutes;
