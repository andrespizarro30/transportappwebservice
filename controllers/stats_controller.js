var db = require('./../helpers/db_helpers')
var helper = require('./../helpers/helpers')
var multiparty = require('multiparty')
var fs = require('fs');
const { duration } = require('moment-timezone');
var imageSavePath = "./public/img/"

var sql = require('mssql');

// const config = {
//     user: 'andresp',
//     password: '123456',
//     server: '192.168.10.11',
//     port: 1433,
//     database: 'taxi_app',
//     "options":{
//         "encrypt":true,
//         "trustServerCertificate": true
//     }
// }

const config = {
    user: 'andrespizarro',
    password: 'Daniel20',
    server: 'andrespizarro.database.windows.net',
    port: 1433,
    database: 'DY_RFID_DataBase',
    "options":{
        "encrypt":true,
        "trustServerCertificate": true
    }
}

const bs_pending = 0
const bs_accept = 1
const bs_go_user = 2
const bs_wait_user = 3
const bs_start = 4
const bs_complete = 5
const bs_cancel = 6
const bs_no_driver = 7
const rideCommissionVal = 0

module.exports.controller = (app, io, socket_list) => {

    app.post('/api/driver_rating', (req, res) => {

        checkAccessToken(req.headers, res, (uObj) => {

            sql.connect(config).then((pool) => {
                return pool
                  .request()
                  .input('user_id', sql.Int, uObj.user_id)
                  .input('booking_status', sql.Int, bs_complete)
                  .query(
                    `SELECT AVG(CAST(driver_rating AS FLOAT)) AS driver_rating FROM booking_detail 
                    WHERE driver_id=@user_id AND booking_status=@booking_status AND driver_rating<>0;
                    
                    SELECT SUM(CASE WHEN booking_status = 5 THEN 1 ELSE 0 END) AS acceptance_number,
                        COUNT(*) AS total_count,
                        (SUM(CASE WHEN booking_status = 5 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS acceptance_percentage
                    FROM booking_detail
                    WHERE driver_id = @user_id AND booking_status > 1;

                    SELECT SUM(CASE WHEN booking_status = 7 THEN 1 ELSE 0 END) AS cancel_number,
                        COUNT(*) AS total_count,
                        (SUM(CASE WHEN booking_status = 7 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS cancel_percentage
                    FROM booking_detail
                    WHERE driver_id = @user_id;
                    `
                  );
              })
              .then((result) => {
        
                const driver_ratings = result.recordsets[0];
                const avg_rating = driver_ratings[0].driver_rating;

                const acceptante_rate = result.recordsets[1];
                const accept_perc = acceptante_rate[0].acceptance_percentage;

                const cancel_rate = result.recordsets[2];
                const cancel_perc = cancel_rate[0].cancel_percentage;

                const response = {
                    "driver_rating": avg_rating,
                    "acceptante_rating": accept_perc,
                    "cancel_rating": cancel_perc
                }
        
                if (driver_ratings.length > 0) {
                    res.json({
                        status: '1',
                        payload: response,
                        message: 'booking request send successfully',
                      });
                }else{
                    res.json({
                        status: '0',
                        message: 'Empty',
                      });
                }
            
                
              })
              .catch((err) => {
                helper.ThrowHtmlError(err, res);
              });

        })
    })

}

function checkAccessToken(helperObj, res, callback, requireType = "") {
    //helper.Dlog(helperObj.access_token)
    helper.CheckParameterValid(res, helperObj, ["access_token"], () => {
        sql.connect(config).then((pool) => {
            return pool
              .request()
              .input('auth_token', sql.VarChar, helperObj.access_token)
              .input('status1', sql.VarChar, '1')
              .input('status2', sql.VarChar, '2')
              .query(
                `SELECT user_id, name, email, gender, mobile, mobile_code, auth_token, 
                 user_type, is_block, image, status 
                 FROM user_detail 
                 WHERE auth_token = @auth_token 
                 AND (status = @status1 OR status = @status2);`
              );
          })
          .then((result) => {
            const user = result.recordset;
        
            if (user.length > 0) {
              //helper.Dlog(user);
        
              if (requireType !== "") {
                if (requireType == user[0].user_type) {
                  return callback(user[0]);
                } else {
                  res.json({
                    status: "0",
                    code: "404",
                    message: "Access denied. Unauthorized user access.",
                  });
                }
              } else {
                return callback(user[0]);
              }
            } else {
              res.json({
                status: "0",
                code: "404",
                message: "Access denied. Unauthorized user access.",
              });
            }
          })
          .catch((err) => {
            helper.ThrowHtmlError(err);
          });
  
    })
}