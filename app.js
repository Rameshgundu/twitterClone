const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();
app.use(express.json());

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

/// authentication

const authentication = async (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "MY_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};
// userCheck

const userPresence = async (request, response, next) => {
  const { tweetId } = request.params;
  const checkFollowing = `SELECT
                    *
                  FROM tweet 
                  inner join follower on 
                  tweet.user_id = follower.following_user_id
                  where tweet_id = ${tweetId};`;
  const dbResp = await db.get(checkFollowing);
  if (dbResp === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

/// User Registration
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const encryptPass = await bcrypt.hash(password, 10);
  const checkUser = `SELECT * FROM user where username = '${username}';`;
  const dbResp = await db.get(checkUser);
  if (dbResp === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const registerQuery = `
            INSERT
            INTO
            user(username, password, name, gender)
            VALUES(
                '${username}',
                '${encryptPass}',
                '${name}',
                '${gender}') ;`;
      await db.run(registerQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

/// user login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  const userCheck = `SELECT * FROM user where username = '${username}';`;
  const dbResp = await db.get(userCheck);
  if (dbResp !== undefined) {
    const verifyPass = await bcrypt.compare(password, dbResp.password);
    if (verifyPass) {
      const payload = {
        username: username,
        userId: dbResp.user_id,
      };
      const jwtToken = await jwt.sign(payload, "MY_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { username } = request;
  const getLatestTweets = `
        SELECT
         distinct(username),
         tweet,
         date_time as dateTime
        FROM (follower
        inner join tweet on 
        follower.following_user_id = tweet.user_id) as t inner join user on 
        t.user_id = user.user_id
        order by date_time desc
        limit ${4};`;
  const dbResp = await db.all(getLatestTweets);
  response.send(dbResp);
});

///get following list
app.get("/user/following/", authentication, async (request, response) => {
  const { username } = request;
  const getFollowingList = `
        SELECT
          name
        FROM
          user 
        inner join follower on 
           user.user_id = follower.following_user_id
        where username != '${username}'
        group by name
        order by user_id;`;
  const dbResp = await db.all(getFollowingList);

  response.send(dbResp);
});

/// API - 5 get followers list

app.get("/user/followers/", authentication, async (request, response) => {
  const { username } = request;
  const getUser = `select user_id from user where username = '${username}';`;
  const getId = await db.get(getUser);
  const userId = getId.user_id;
  const followerQuery = `
            SELECT
                distinct name
            FROM
                follower 
            inner join user on 
                follower.follower_user_id = user.user_id
            where following_user_id = '${userId}';
            order by user_id;`;
  const result = await db.all(followerQuery);
  response.send(result);
});

/// API-6 Get particular tweet
app.get(
  "/tweets/:tweetId/",
  authentication,
  userPresence,
  async (request, response) => {
    const { tweetId } = request.params;
    const getStats = `
        SELECT
          tweet,
          count(distinct(like_id)) as likes,
          count(distinct(reply)) as replies, 
          date_time as dateTime
        FROM (tweet inner join like on 
          tweet.tweet_id = like.tweet_id)
          as t inner join reply
          on t.tweet_id = reply.tweet_id
        where t.tweet_id=${tweetId}
        group by t.tweet_id;`;
    const result = await db.get(getStats);
    response.send(result);
  }
);
//API - 7
app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  userPresence,
  async (request, response) => {
    const { tweetId } = request.params;
    const getUserNames = `
            SELECT
              distinct username
            FROM user
            inner join like on 
            user.user_id = like.user_id
            where tweet_id = ${tweetId};
            `;
    const nameArray = await db.all(getUserNames);
    const endRes = nameArray.map((name1) => name1.username);
    response.send({ likes: endRes });
  }
);

///API - 8
app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  userPresence,
  async (request, response) => {
    const { tweetId } = request.params;
    const getReplies = `
        SELECT name, reply FROM
        user inner join reply on
        user.user_id = reply.user_id
        where tweet_id = ${tweetId};`;
    const dbResp = await db.all(getReplies);

    response.send({ replies: dbResp });
  }
);

//API - 9
app.get("/user/tweets/", authentication, async (request, response) => {
  const { username } = request;
  const getUser = `select user_id from user where username = '${username}';`;
  const getId = await db.get(getUser);
  const userId = getId.user_id;
  const getStatsOfUser = `
        SELECT
         tweet,
         count(distinct(like_id)) as likes, 
         count(distinct(reply_id)) as replies, 
         date_time as dateTime
        FROM 
            (tweet left join like on 
            tweet.tweet_id = like.tweet_id) as t left join reply 
            on t.tweet_id = reply.tweet_id
        where t.user_id = ${userId}
        group by t.tweet_id;`;

  const result = await db.all(getStatsOfUser);
  response.send(result);
});
module.exports = app;

//API - 10
app.post("/user/tweets/", authentication, async (request, response) => {
  const { username } = request;
  const getUser = `select user_id from user where username = '${username}';`;
  const getId = await db.get(getUser);
  const userId = getId.user_id;
  const { tweet } = request.body;
  const dateTime = "2023-04-14 11:33:15";
  const createTweet = `
        INSERT INTO tweet(tweet, user_id, date_time)
        VALUES(
            '${tweet}',
            ${userId},
            '${dateTime}');`;
  await db.run(createTweet);
  response.send("Created a Tweet");
});

//API-11

app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getUser = `select user_id from user where username = '${username}';`;
  const getId = await db.get(getUser);
  const userId = getId.user_id;
  const isValidTweet = `SELECT * FROM tweet 
                            where user_id = ${userId} AND tweet_id = ${tweetId};`;
  const dbResponse = await db.get(isValidTweet);

  if (dbResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweet = `
    DELETE
    FROM
      tweet
    where
       tweet_id = ${tweetId};`;
    await db.run(deleteTweet);
    response.send("Tweet Removed");
  }
});
