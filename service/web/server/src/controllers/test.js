import {addJobToQueue} from './job';
import {getWorkerData} from './just-in-time-data.js';

function promiseTaskLater(task, time, ...args) {
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

function setU(site_ref, u, redis) {
  return new Promise((resolve, reject) => {
    redis.hset(site_ref, 'u', JSON.stringify(u), (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

function sendStopSignal(site_ref, pub) {
  pub.publish(site_ref, "stop");
}

export function simStatus(site_ref, redis) {
  return new Promise((resolve, reject) => {
    redis.hget(site_ref, 'status', (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
};

export async function waitForStatus(id, redis, desiredStatus, count, maxCount) {
  let i = 0;
  const currentStatus = await simStatus(id, redis);
  if (currentStatus == desiredStatus) {
    return;
  } else if (count == maxCount) {
    throw(`Timeout waiting for test: ${id} to reach status: ${desiredStatus}`);
  } else {
    await promiseTaskLater(waitForStatus, 2000, id, redis, desiredStatus, count, maxCount);
  }
};

export function setStatus(site_ref, stat, redis) {
  return new Promise((resolve, reject) => {
    redis.hset(site_ref, 'status', stat, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

export function getY(site_ref, redis) {
  return new Promise((resolve, reject) => {
    redis.hget(site_ref, 'y', (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

export function getForecastParameters(site_ref, redis) {
  return new Promise((resolve, reject) => {
    redis.hget(site_ref, 'forecast_parameters', (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

export function setForecastParameters(site_ref, horizon, interval, redis) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({horizon: Number(horizon), interval: Number(interval)})
    redis.hset(site_ref, 'forecast_parameters', data, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

export function getForecast(site_ref, redis) {
  return getWorkerData(site_ref, "forecast", redis, {});
}

export async function initialize(site_ref, start_time, warmup_period, redis, sqs) {
  await setStatus(site_ref, "Starting", redis)
  await addJobToQueue("runSite", sqs, {site_ref, start_time, warmup_period})
  await waitForStatus(site_ref, redis, "Running", 0, 3)
  return await getY(site_ref, redis)
}

export async function getScenario(site_ref, db, redis) {
  const scenario = await new Promise((resolve, reject) => {
    // Look in redis first for a cached value,
    // running tests should have a cached value.
    // Fallback to the testcase default from database
    redis.hget(site_ref, 'scenario', (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
  // Running tests should have a scenario in redis.
  // If there is no running test then look for the default
  // value stored in db
  if (scenario) {
    return scenario
  } else {
    const testcases = db.collection('testcases')
    const query = {site_ref}
    const doc = await testcases.findOne(query)
    return doc.scenario
  }
}

export async function setScenario(site_ref, scenario, db, redis, sqs) {
  await new Promise((resolve, reject) => {
    redis.hset(site_ref, 'scenario', JSON.stringify(scenario), (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
  // What should these values be?
  const start_time = 0
  const warmup_period = 0
  await initialize(site_ref, start_time, warmup_period, redis, sqs)
  return await getScenario(site_ref, db, redis)
}

export async function advance(site_ref, redis, advancer, u) {
  await setU(site_ref, u, redis)
  await advancer.advance([site_ref])
  return await getY(site_ref, redis)
}

export async function stop(site_ref, redis, pub) {
  const stat = await simStatus(site_ref, redis)
  if (stat == "Running") {
    await setStatus(site_ref, "Stopping", redis)
    sendStopSignal(site_ref, pub)
    await waitForStatus(site_ref, redis, "Stopped", 0, 3)
  }
}

