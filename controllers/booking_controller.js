var db = require('./../helpers/db_helpers')
var helper = require('./../helpers/helpers')
var multiparty = require('multiparty')
var fs = require('fs');
const { duration } = require('moment-timezone');
var imageSavePath = "./public/img/";

const { GoogleAuth } = require('google-auth-library');

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

var sql = require('mssql');

const config = {
    user: 'andresp',
    password: '123456',
    server: '192.168.10.12',
    port: 1433,
    database: 'taxi_app',
    "options":{
        "encrypt":true,
        "trustServerCertificate": true
    }
}

// const config = {
//     user: 'andrespizarro',
//     password: 'Daniel20',
//     server: 'andrespizarro.database.windows.net',
//     port: 1433,
//     database: 'DY_RFID_DataBase',
//     "options":{
//         "encrypt":true,
//         "trustServerCertificate": true
//     }
// }

//Booking Status

const bs_pending = 0
const bs_accept = 1
const bs_go_user = 2
const bs_wait_user = 3
const bs_start = 4
const bs_complete = 5
const bs_cancel = 6
const bs_no_driver = 7
const rideCommissionVal = 0

//Notification ID

const nt_id_1_new_request = "1"
const nt_id_2_accpet_request = "2"
const nt_id_3_driver_wait = "3"
const nt_id_4_ride_start = "4"
const nt_id_5_ride_complete = "5"
const nt_id_6_ride_cancel = "6"
const nt_id_7_drive_no_available = "7"

//Notification ID

const nt_t_1_new_request = "New Request"
const nt_t_2_accpet_request = "Driver Accepted"
const nt_t_3_driver_wait = "Driver is waiting"
const nt_t_4_ride_start = "Ride Started"
const nt_t_5_ride_complete = "Ride Completed"
const nt_t_6_ride_cancel = "Ride Cancelled"
const nt_t_7_drive_no_available = "No Driver available"

//User Type:
const ut_admin = 4
const ut_driver = 2
const ut_user = 1

var controllerIO;
var controllerSocketList;

const newRequestTimeABC = 15 // time in 30 min
const requestAcceptTime = 60 // time in second
const requestWaitingAcceptTime = requestAcceptTime + 5 // time in second
const userRideCancelTime = 60 * 5 // time in second
const userWaitingTime = 60 * 5 // time in second

const requestPendingArray = [];
const userLocationInfoArray = {};
const driverUserWaitingArray = {};

module.exports.controller = (app, io, socket_list) => {

    controllerIO = io;
    controllerSocketList = socket_list;

    const msg_success = "successfully";
    const msg_fail = "fail";
    const msg_invalidUser = "invalid username";
    const msg_all_ready_book = "all ready other ride scheduled booking."



    //App Api

    //Check Per Pending Request  8:45 to 9:15 
    //Booking Time = 9:00 

    app.post('/api/booking_request', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["pickup_latitude", "pickup_longitude", "pickup_address", "drop_latitude", "drop_longitude", "drop_address", "pickup_date", "payment_type", "card_id", "price_id", "est_total_distance", 'est_duration', 'amount', "service_id"], () => {

                helper.Dlog(" Date Time:  " + helper.serverDateTimeAddMin(reqObj.pickup_date, "YYYY-MM-DD HH:mm:ss", -newRequestTimeABC) + " , " + helper.serverDateTimeAddMin(reqObj.pickup_date, "YYYY-MM-DD HH:mm:ss", newRequestTimeABC));
                
                sql.connect(config).then((pool) => {
                    return pool
                      .request()
                      .input('user_id', sql.Int, uObj.user_id)
                      .input('pickup_start', sql.DateTime, helper.serverDateTimeAddMin(reqObj.pickup_date, "YYYY-MM-DD HH:mm:ss", -newRequestTimeABC))
                      .input('pickup_end', sql.DateTime, helper.serverDateTimeAddMin(reqObj.pickup_date, "YYYY-MM-DD HH:mm:ss", newRequestTimeABC))
                      .input('booking_status', sql.Int, bs_complete)
                      .input('price_id', sql.Int, reqObj.price_id)
                      .query(
                        `SELECT COUNT(*) AS booking_count 
                        FROM booking_detail 
                        WHERE user_id = @user_id 
                        AND (pickup_date BETWEEN @pickup_start AND @pickup_end) 
                        AND booking_status < @booking_status;
                
                        SELECT pd.base_charge, pd.booking_charge, zl.tax, pd.per_km_charge, 
                        pd.per_min_charge, pd.mini_fair, pd.mini_km, pd.cancel_charge 
                        FROM price_detail AS pd 
                        INNER JOIN zone_list AS zl ON zl.zone_id = pd.zone_id 
                        WHERE pd.price_id = @price_id;`
                      );
                  })
                  .then((result) => {
                    const bookingCount = result.recordsets[0][0].booking_count;
                    const priceDetails = result.recordsets[1];
                
                    if (bookingCount === 0) {
                      if (priceDetails.length > 0) {
                        const amount = parseInt(reqObj.amount);
                        const totalAmount = (amount * 100) / (100 + parseInt(priceDetails[0].tax));
                        const taxAmount = (amount - totalAmount).toFixed(3);
                        const driverAmount = (
                          (totalAmount - parseFloat(priceDetails[0].booking_charge)) * 
                          (1 - rideCommissionVal / 100.0)
                        ).toFixed(2);
                        const rideCommission = (totalAmount - driverAmount).toFixed(2);
                
                        helper.Dlog([reqObj.card_id, reqObj.payment_type, amount, 0, driverAmount, taxAmount, rideCommission]);
                
                        return sql
                          .connect(config)
                          .then((pool) => {
                            return pool
                              .request()
                              .input('card_id', sql.Int, reqObj.card_id)
                              .input('payment_type', sql.VarChar, reqObj.payment_type)
                              .input('amt', sql.Decimal, amount)
                              .input('discount_amt', sql.Decimal, 0)
                              .input('driver_amt', sql.Decimal, driverAmount)
                              .input('tax_amt', sql.Decimal, taxAmount)
                              .input('ride_commission', sql.Decimal, rideCommission)
                              .query(
                                `INSERT INTO payment_detail (card_id, payment_type, amt, discount_amt, driver_amt, tax_amt, ride_commission, created_date, modify_date)
                                 VALUES (@card_id, @payment_type, @amt, @discount_amt, @driver_amt, @tax_amt, @ride_commission, GETDATE(), GETDATE());
                                 SELECT SCOPE_IDENTITY() AS payment_id;`
                              );
                          })
                          .then((pResult) => {
                            const paymentId = pResult.recordset[0].payment_id;
                
                            return sql
                              .connect(config)
                              .then((pool) => {
                                return pool
                                  .request()
                                  .input('user_id', sql.Int, uObj.user_id)
                                  .input('pickup_lat', sql.Float, reqObj.pickup_latitude)
                                  .input('pickup_long', sql.Float, reqObj.pickup_longitude)
                                  .input('pickup_address', sql.VarChar, reqObj.pickup_address)
                                  .input('drop_lat', sql.Float, reqObj.drop_latitude)
                                  .input('drop_long', sql.Float, reqObj.drop_longitude)
                                  .input('drop_address', sql.VarChar, reqObj.drop_address)
                                  .input('pickup_date', sql.DateTime, reqObj.pickup_date)
                                  .input('service_id', sql.Int, reqObj.service_id)
                                  .input('price_id', sql.Int, reqObj.price_id)
                                  .input('payment_id', sql.Int, paymentId)
                                  .input('est_total_distance', sql.Float, reqObj.est_total_distance)
                                  .input('est_duration', sql.Float, reqObj.est_duration)
                                  .query(
                                    `INSERT INTO booking_detail (user_id, pickup_lat, pickup_long, pickup_address, drop_lat, drop_long, drop_address, pickup_date, service_id, price_id, payment_id, est_total_distance, est_duration, created_date)
                                    VALUES (@user_id, @pickup_lat, @pickup_long, @pickup_address, @drop_lat, @drop_long, @drop_address, '${reqObj.pickup_date}', @service_id, @price_id, @payment_id, @est_total_distance, @est_duration, GETDATE());
                                    SELECT SCOPE_IDENTITY() AS booking_id;`
                                  );
                              });
                          })
                          .then((bookingResult) => {

                            const bookingId = bookingResult.recordset[0].booking_id;
                
                            return sql
                              .connect(config)
                              .then((pool) => {
                                return pool
                                  .request()
                                  .input('booking_id', sql.Int, bookingId)
                                  .input('booking_status', sql.Int, bs_pending)
                                  .query(
                                    `SELECT bd.booking_id, bd.driver_id, bd.user_id, bd.pickup_lat, bd.pickup_long, bd.pickup_address, bd.drop_lat, bd.drop_long, bd.drop_address, bd.pickup_date, bd.service_id, bd.price_id, bd.payment_id, bd.est_total_distance, bd.est_duration, bd.created_date, bd.accpet_time, bd.start_time, bd.stop_time, bd.booking_status, bd.request_driver_id, pd.zone_id, pd.mini_km, sd.service_name, sd.color, sd.icon, ud.name, ud.mobile, ud.mobile_code, ud.push_token, (CASE WHEN ud.image != '' THEN CONCAT( '${helper.ImagePath()}', ud.image ) ELSE '' END) AS image, ppd.amt, ppd.driver_amt, ppd.payment_type 
                                    FROM booking_detail AS bd 
                                    INNER JOIN user_detail AS ud ON ud.user_id = bd.user_id 
                                    INNER JOIN price_detail AS pd ON pd.price_id = bd.price_id 
                                    INNER JOIN payment_detail AS ppd ON ppd.payment_id = bd.payment_id 
                                    INNER JOIN service_detail AS sd ON bd.service_id = sd.service_id 
                                    WHERE bd.booking_id = @booking_id AND bd.booking_status = @booking_status;`
                                  );
                              });
                          })
                          .then((finalResult) => {
                            if (finalResult.recordset.length > 0) {
                              driverNewRequestSend(finalResult.recordset[0], (status, bookingInfo) => {
                                if (status == 1) {
                                  res.json({
                                    status: '1',
                                    payload: finalResult.recordset[0],
                                    message: 'booking request sent successfully',
                                  });
                                } else {
                                  res.json({
                                    status: '2',
                                    payload: finalResult.recordset[0],
                                    message: bookingInfo,
                                  });
                                }
                              });
                            } else {
                              res.json({ status: '0', message: 'Booking info not found' });
                            }
                          })
                          .catch((err) => {
                            helper.ThrowHtmlError(err, res);
                          });
                      } else {
                        res.json({ status: '0', message: 'invalid service' });
                      }
                    } else {
                      res.json({ status: '0', message: msg_all_ready_book });
                    }
                  })
                  .catch((err) => {
                    helper.ThrowHtmlError(err, res);
                  });  

            })
        })
    })

    app.post('/api/update_location', (req, res) => {
        //helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["latitude", "longitude", "socket_id"], () => {
                var location = {

                    'latitude': reqObj.latitude,
                    'longitude': reqObj.longitude
                }
                socket_list["us_" + uObj.user_id.toString()] = {
                    'socket_id': reqObj.socket_id
                };

                userLocationInfoArray['us_' + uObj.user_id] = {
                    "location": location
                }
                // Tracking OP

                sql.connect(config).then((pool) => {
                    return pool
                        .request()
                        .input('latitude', sql.Decimal(18, 9), reqObj.latitude)
                        .input('longitude', sql.Decimal(18, 9), reqObj.longitude)
                        .input('user_id', sql.Int, uObj.user_id)
                        .input('user_type', sql.Int, ut_driver)
                        .query("UPDATE user_detail SET lati = @latitude, longi = @longitude WHERE user_id = @user_id AND user_type = @user_type");
                })
                .then((result) => {
                    if (result.rowsAffected > 0) {
                        res.json({
                            'status': "1",
                            "message": msg_success
                        });

                        const response = {
                            "status": "1",
                            "payload": {
                                "user_id": parseInt(uObj.user_id),
                                "latitude": reqObj.latitude == '0.0' ? 0.0 : parseFloat(reqObj.latitude),
                                "longitude": reqObj.longitude == '0.0' ? 0.0 : parseFloat(reqObj.longitude)
                            },
                        };

                        helper.Dlog(response);

                        Object.entries(controllerSocketList).forEach(([key, value]) => {
                            helper.Dlog(value.socket_id);
                            controllerIO.sockets.sockets.get(value.socket_id).emit("drivers_location", response);
                        });                        

                    } else {
                        res.json({
                            'status': "0",
                            "message": msg_fail
                        });
                    }
                })
                .catch((err) => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })
    })

    app.post('/api/ride_request_accept', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "request_token"], () => {
                sql.connect(config).then((pool) => {
                    return pool
                        .request()
                        .input('booking_id', sql.Int, reqObj.booking_id)
                        .query("SELECT booking_status FROM booking_detail WHERE booking_id = @booking_id");
                })
                .then((result) => {
                    if (result.recordset.length > 0) {
                
                        if (requestPendingArray[reqObj.request_token] === undefined || requestPendingArray[reqObj.request_token] === null) {
                            res.json({
                                "success": "2",
                                "message": "request token invalid"
                            });
                            return;
                        }
                
                        if (result.recordset[0].booking_status === bs_cancel) {
                            res.json({
                                "success": "2",
                                "message": "ride user cancel request"
                            });
                            return;
                        } else {
                            const otpCode = Math.floor(1000 + Math.random() * 9000);
                
                            // Second query: Updating booking details
                            sql.connect(config).then((pool) => {
                                return pool
                                    .request()
                                    .input('otp_code', sql.Int, otpCode)
                                    .input('booking_id', sql.Int, reqObj.booking_id)
                                    .input('booking_status', sql.Int, 1)
                                    .input('driver_id', sql.Int, uObj.user_id)
                                    .input('is_request_send', sql.Int, 2)
                                    .query(`
                                        UPDATE bd
                                        SET 
                                            bd.booking_status = @booking_status, 
                                            bd.accpet_time = GETDATE(), 
                                            bd.start_time = GETDATE(), 
                                            bd.user_car_id = ud.car_id, 
                                            bd.otp_code = @otp_code
                                        FROM booking_detail AS bd
                                        INNER JOIN user_detail AS ud ON bd.driver_id = ud.user_id
                                        INNER JOIN user_detail AS rud ON bd.user_id = rud.user_id
                                        INNER JOIN service_detail AS sd ON bd.service_id = sd.service_id
                                        WHERE bd.booking_id = @booking_id AND bd.driver_id = @driver_id;
                                        UPDATE ud
                                        SET 
                                            ud.status = 2, 
                                            ud.is_request_send = @is_request_send
                                        FROM user_detail AS ud
                                        INNER JOIN booking_detail AS bd ON bd.driver_id = ud.user_id
                                        INNER JOIN service_detail AS sd ON bd.service_id = sd.service_id
                                        WHERE bd.booking_id = @booking_id AND bd.driver_id = @driver_id;
                                        UPDATE rud
                                        SET 
                                            rud.status = 2
                                        FROM user_detail AS rud
                                        INNER JOIN booking_detail AS bd ON bd.user_id = rud.user_id
                                        INNER JOIN service_detail AS sd ON bd.service_id = sd.service_id
                                        WHERE bd.booking_id = @booking_id AND bd.driver_id = @driver_id;
                                    `);
                            })
                            .then((result) => {
                                if (result.rowsAffected[0] > 0 && result.rowsAffected[1] > 0 && result.rowsAffected[2] > 0) {
                                    removeRequestTokenPendingArr[reqObj.request_token];
                                    helper.Dlog("--------------------- ride accepted successfully --------------");
                
                                    res.json({
                                        "status": "1",
                                        "message": "ride accepted successfully"
                                    });
                
                                    // Third query: Fetching user details
                                    sql.connect(config).then((pool) => {
                                        return pool
                                            .request()
                                            .input('booking_id', sql.Int, reqObj.booking_id)
                                            .query(`
                                                SELECT ud.push_token, ud.user_id, bd.pickup_date 
                                                FROM booking_detail AS bd
                                                INNER JOIN user_detail AS ud ON ud.user_id = bd.user_id
                                                WHERE bd.booking_id = @booking_id
                                            `);
                                    })
                                    .then((result) => {
                                        if (result.recordset.length > 0) {
                                            helper.Dlog(result.recordset);
                                            helper.Dlog("--------------------- ride accepted successfully " + result.recordset[0].user_id + "--------------");
                
                                            const userSocket = controllerSocketList['us_' + result.recordset[0].user_id];
                                            if (userSocket && controllerIO.sockets.sockets.get(userSocket.socket_id)) {
                                                const response = {
                                                    "status": "1",
                                                    "payload": {
                                                        "booking_id": parseInt(reqObj.booking_id),
                                                        "booking_status": bs_accept,
                                                        "ride_cancel": userRideCancelTime
                                                    },
                                                    "message": "driver accepted your request"
                                                };
                
                                                controllerIO.sockets.sockets.get(userSocket.socket_id).emit("user_request_accept", response);
                                            }
                
                                            // Push notification
                                            oneSignalPushFire('1', [result.recordset[0].push_token], nt_t_2_accpet_request, "driver ride accepted", {
                                                "booking_id": reqObj.booking_id,
                                                "booking_status": bs_accept.toString(),
                                                "ride_cancel": userRideCancelTime.toString(),
                                                "notification_id": nt_id_2_accpet_request
                                            });
                                        }
                                    })
                                    .catch((err) => {
                                        helper.ThrowHtmlError(err, res);
                                    });
                
                                } else {
                                    res.json({
                                        "success": "0",
                                        "message": msg_fail
                                    });
                                }
                            })
                            .catch((err) => {
                                helper.ThrowHtmlError(err, res);
                            });
                        }
                    } else {
                        res.json({
                            "success": "0",
                            "message": msg_fail
                        });
                    }
                })
                .catch((err) => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        }, ut_driver)

    })

    app.post('/api/ride_request_decline', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "request_token"], () => {
                if (requestPendingArray[reqObj.request_token] == undefined || requestPendingArray[reqObj.request_token] == null) {
                    res.json({
                        "success": "2",
                        "message": "request token invalid"
                    })
                } else {
                    sql.connect(config).then((pool) => {
                        // Update query to reset the 'is_request_send' field
                        return pool
                            .request()
                            .input('is_request_send', sql.Int, 0)
                            .input('user_id', sql.Int, uObj.user_id)
                            .query(`
                                UPDATE user_detail
                                SET is_request_send = @is_request_send
                                WHERE user_id = @user_id
                            `);
                    })
                    .then((result) => {
                        // Check if the query affected any rows
                        if (result.rowsAffected > 0) {
                            removeRequestTokenPendingArr(reqObj.request_token);
                            res.json({
                                "status": "1",
                                "message": "Ride request declined successfully"
                            });
                    
                            // Call the function to handle sending a new request based on booking ID
                            driverNewRequestSendByBookingID(reqObj.booking_id);
                    
                        } else {
                            res.json({
                                "status": "0",
                                "message": msg_fail
                            });
                        }
                    })
                    .catch((err) => {
                        // Handle any errors from the query
                        helper.ThrowHtmlError(err, res);
                    });
                }
            })
        }, ut_driver)

    })

    app.post('/api/driver_cancel_ride', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "booking_status"], () => {
                if (reqObj.booking_status == bs_wait_user || reqObj.booking_status == bs_go_user) {
                    userRideCancel(reqObj.booking_id, reqObj.booking_status, uObj.user_id, ut_driver, false, (resObj) => {
                        res.json(resObj)
                    })
                } else {
                    res.json({
                        "success": "0",
                        "message": "Not Ride Cancelled! Only Recall Ride is available before starting of ride"
                    })
                }
            })
        }, ut_driver)
    })

    app.post('/api/user_cancel_ride', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "booking_status"], () => {
                userRideCancel(reqObj.booking_id, reqObj.booking_status, uObj.user_id, ut_user, false, (resObj) => {
                    res.json(resObj)
                })
            })
        }, ut_user)
    })

    app.post('/api/user_cancel_ride_force', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "booking_status"], () => {
                userRideCancel(reqObj.booking_id, reqObj.booking_status, uObj.user_id, ut_user, true, (resObj) => {
                    res.json(resObj)
                })
            })
        }, ut_user)
    })

    app.post('/api/booking_detail', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id"], () => {
                bookingInformationDetail(reqObj.booking_id, uObj.user_type).then((result) => {
                    if (uObj.user_type === ut_user) {
                        return bookingInformationDetail(reqObj.booking_id, "2").then((result) => {
                            res.json({
                                status: "1",
                                payload: result[0],
                            });
                        })
                        .catch((error) => {
                            res.json({
                                status: "0",
                                result: error,
                            });
                        });
                    } else {
                        res.json({
                            status: "0",
                            result,
                        });
                    }
            })
            .catch((error) => {
                if (error[0]?.booking_status === bs_complete) {
                    res.json({
                        status: "1",
                        payload: error[0],
                    });
                } else {
                    res.json({
                        status: "1",
                        payload: error[0],
                    });
                }
            });
            })
        })
    })

    app.post('/api/driver_wait_user', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id"], () => {
                sql.connect(config).then(pool => {
                    return pool
                        .request()
                        .input('booking_status', sql.Int, bs_wait_user)
                        .input('booking_id', sql.Int, reqObj.booking_id)
                        .input('driver_id', sql.Int, uObj.user_id)
                        .input('status_limit', sql.Int, bs_wait_user)
                        .query(`
                            UPDATE booking_detail 
                            SET booking_status = @booking_status, start_time = GETDATE() 
                            WHERE booking_id = @booking_id 
                            AND driver_id = @driver_id 
                            AND booking_status < @status_limit
                        `);
                })
                .then(result => {
                    if (result.rowsAffected > 0) {
                        // Query the booking details and user push token
                        return sql.connect(config)
                            .then(pool => {
                                return pool
                                    .request()
                                    .input('booking_id', sql.Int, reqObj.booking_id)
                                    .query(`
                                        SELECT bd.*, ud.push_token 
                                        FROM booking_detail AS bd 
                                        INNER JOIN user_detail AS ud ON ud.user_id = bd.user_id 
                                        WHERE bd.booking_id = @booking_id
                                    `);
                            })
                            .then(result => {
                                if (result.recordset.length > 0) {
                                    const bookingDetails = result.recordset[0];
                                    
                                    helper.timeDuration(bookingDetails.pickup_date, helper.serverYYYYMMDDHHmmss(), (totalMin, _) => {
                                        let waitingTime = userWaitingTime;
                                        if (totalMin > 0) {
                                            waitingTime += totalMin * 60;
                                        }
            
                                        // Handle waiting time
                                        driverUserWaitingTimeOver(reqObj.booking_id, waitingTime);
            
                                        // Emit a socket event to notify the user
                                        const userSocket = controllerSocketList['us_' + bookingDetails.user_id];
                                        if (userSocket && controllerIO.sockets.sockets.get(userSocket.socket_id)) {
                                            const responseObj = {
                                                status: "1",
                                                payload: {
                                                    booking_id: parseInt(reqObj.booking_id),
                                                    waiting: waitingTime,
                                                    booking_status: bs_wait_user
                                                },
                                                message: "driver waiting"
                                            };
                                            controllerIO.sockets.sockets.get(userSocket.socket_id).emit("driver_wait_user", responseObj);
                                        }
            
                                        // Send push notification via OneSignal
                                        oneSignalPushFire(1, [bookingDetails.push_token], nt_t_3_driver_wait, "driver is waiting", {
                                            booking_id: reqObj.booking_id,
                                            waiting: waitingTime,
                                            booking_status: bs_wait_user.toString(),
                                            notification_id: nt_id_3_driver_wait
                                        });
            
                                        // Retrieve full booking information
                                        bookingInformationDetail(reqObj.booking_id, '2')
                                            .then(resultDetails => {
                                                if (resultDetails.status !== 0) {
                                                    resultDetails[0].waiting = waitingTime;
                                                    res.json({
                                                        status: "1",
                                                        payload: resultDetails[0],
                                                        message: "user notified"
                                                    });
                                                }
                                            })
                                            .catch(err => {
                                                helper.Dlog(err, res);
                                                res.json({
                                                    status: "0",
                                                    message: "Error retrieving booking details"
                                                });
                                            });
                                    });
                                } else {
                                    res.json({
                                        status: "0",
                                        message: "No booking information found"
                                    });
                                }
                            });
                    } else {
                        res.json({
                            status: "0",
                            message: "Failed to update user wait"
                        });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })

    })

    app.post('/api/ride_start', (req, res) => {

        helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "pickup_latitude", "pickup_longitude", "otp_code"], () => {

                var otp_code = Math.floor(1000 + Math.random() * 9000)
                sql.connect(config).then(pool => {
                    return pool
                        .request()
                        .input('booking_status', sql.Int, bs_start)
                        .input('pickup_lat', sql.Float, reqObj.pickup_latitude)
                        .input('pickup_long', sql.Float, reqObj.pickup_longitude)
                        .input('otp_code', sql.Int, otp_code)
                        .input('booking_id', sql.Int, reqObj.booking_id)
                        .input('current_status', sql.Int, bs_start)
                        .input('driver_id', sql.Int, uObj.user_id)
                        .input('user_id', sql.Int, uObj.user_id)
                        .input('old_otp_code', sql.Int, reqObj.otp_code)
                        .query(`
                            UPDATE bd
                            SET bd.booking_status = @booking_status, 
                                bd.pickup_lat = @pickup_lat, 
                                bd.pickup_long = @pickup_long, 
                                bd.start_time = GETDATE(), 
                                bd.otp_code = @otp_code
                            FROM booking_detail bd
                            WHERE bd.booking_id = @booking_id
                            AND bd.booking_status < @current_status
                            AND bd.driver_id = @driver_id
                            AND bd.otp_code = @old_otp_code;
                            UPDATE dd
                            SET dd.status = 2
                            FROM user_detail dd
                            INNER JOIN booking_detail bd ON dd.user_id = bd.driver_id
                            WHERE bd.booking_id = @booking_id;
                            UPDATE ud
                            SET ud.status = 2
                            FROM user_detail ud
                            INNER JOIN booking_detail bd ON ud.user_id = bd.user_id
                            WHERE bd.booking_id = @booking_id;
                        `);
                })
                .then(result => {
                    if (result.rowsAffected[0] > 0 && result.rowsAffected[1] > 0 && result.rowsAffected[2] > 0) {
                        removeDriverWaitUser(reqObj.booking_id);
                        bookingInformationDetail(reqObj.booking_id, '2').then((result) => {
                            res.json({
                                status: "1",
                                payload: result[0],
                                message: "Ride started successfully",
                            });
                        })
                        .catch((error) => {
                            console.error('Error fetching booking details:', error);
                            // Handle the error case if needed, e.g., sending a different response
                        });
    
                
                        return sql.connect(config).then(pool => {
                            return pool
                                .request()
                                .input('booking_id', sql.Int, reqObj.booking_id)
                                .query(`
                                    SELECT bd.*, ud.push_token, pd.mini_km 
                                    FROM booking_detail AS bd
                                    INNER JOIN user_detail AS ud ON ud.user_id = bd.user_id
                                    INNER JOIN price_detail AS pd ON bd.price_id = pd.price_id
                                    WHERE bd.booking_id = @booking_id
                                `);
                        });
                    } else {
                        res.json({
                            "status": "0",
                            "message": "Ride start failed"
                        });
                    }
                })
                .then(result2 => {
                    if (result2.recordset.length > 0) {
                        const userSocket = controllerSocketList['us_' + result2.recordset[0].user_id];
                        if (userSocket && controllerIO.sockets.sockets.get(userSocket.socket_id)) {
                            const responseObj = {
                                "status": "1",
                                "payload": {
                                    "booking_id": parseInt(reqObj.booking_id),
                                    "booking_status": bs_start
                                },
                                "message": "Driver started ride"
                            };
                
                            controllerIO.sockets.sockets.get(userSocket.socket_id).emit("ride_start", responseObj);
                        }
                
                        oneSignalPushFire(1, [result2.recordset[0].push_token], nt_t_4_ride_start, "Driver is waiting", {
                            "booking_id": reqObj.booking_id,
                            "booking_status": bs_start.toString(),
                            "notification_id": nt_id_4_ride_start
                        });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });

            })
        })


    })

    app.post('/api/ride_stop', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "drop_latitude", "drop_longitude", "toll_tax", "ride_location"], () => {
                const rideLocations = reqObj.ride_location.replace(/,(\s*)]$/, ']')
                var stopTime = helper.serverYYYYMMDDHHmmss()
                var rideLocationString = "";
                var rideLocationArr = JSON.parse(rideLocations);
                var totalKM = 0;

                rideLocationArr.forEach((locationDetail, index) => {
                    rideLocationString += '[' + locationDetail.latitude + ',' + locationDetail.longitude + ',' + locationDetail.time + '],';
                    if (index != 0) {
                        totalKM += helper.distance(rideLocationArr[index - 1].latitude, rideLocationArr[index - 1].longitude, locationDetail.latitude, locationDetail.longitude)
                    }
                })

                helper.Dlog("Total KM : " + totalKM);

                sql.connect(config).then(pool => {
                    return pool
                        .request()
                        .input('booking_id', sql.Int, reqObj.booking_id)
                        .query(`
                            SELECT pd.*, bd.start_time, zl.*, bd.booking_id 
                            FROM price_detail AS pd
                            INNER JOIN booking_detail AS bd ON pd.price_id = bd.price_id
                            INNER JOIN zone_list AS zl ON zl.zone_id = pd.zone_id
                            WHERE bd.booking_id = @booking_id
                        `);
                })
                .then(result => {
                    if (result.recordset.length > 0) {
                        const bookingDetail = result.recordset[0];

                        const date1 = helper.serverMySqlDate(bookingDetail.start_time);
                        let date2 = bookingDetail.start_time;
                        date2 = date2.setHours(date2.getHours() + 5);
                
                        helper.timeDuration(stopTime, date2, (totalMin, durationString) => {
                            //let totalKM = reqObj.totalKM;
                            if (bookingDetail.mini_km > totalKM) {
                                totalKM = parseFloat(bookingDetail.mini_km);
                            }
                
                            let amount = parseFloat(bookingDetail.base_charge) +
                                (totalKM * parseFloat(bookingDetail.per_km_charge)) +
                                (totalMin * parseFloat(bookingDetail.per_min_charge)) +
                                parseFloat(bookingDetail.booking_charge);
                
                            if (bookingDetail.mini_fair >= amount) {
                                amount = parseFloat(bookingDetail.mini_fair);
                            }
                
                            const totalAmount = (amount * 100) / (100 + parseInt(bookingDetail.tax));
                            const taxAmount = (amount - totalAmount).toFixed(3);
                            const driverAmount = ((totalAmount - parseFloat(bookingDetail.booking_charge)) * (1 - (rideCommissionVal / 100.0))).toFixed(2);
                            const finalTotalAmount = totalAmount + parseFloat(reqObj.toll_tax);
                            const rideCommission = parseFloat(finalTotalAmount - driverAmount).toFixed(2);
                
                            // Single query to update all related tables using MERGE
                            sql.connect(config).then(pool => {
                                return pool
                                    .request()
                                    .input('booking_status', sql.Int, bs_complete)
                                    .input('toll_tax', sql.Float, reqObj.toll_tax)
                                    .input('total_distance', sql.Float, totalKM)
                                    .input('duration', sql.VarChar, durationString)
                                    .input('totalAmount', sql.Float, finalTotalAmount)
                                    .input('drop_lat', sql.Float, reqObj.drop_latitude)
                                    .input('drop_long', sql.Float, reqObj.drop_longitude)
                                    .input('driverAmount', sql.Float, driverAmount)
                                    .input('taxAmount', sql.Float, taxAmount)
                                    .input('rideCommission', sql.Float, rideCommission)
                                    .input('booking_id', sql.Int, reqObj.booking_id)
                                    .input('driver_id', sql.Int, uObj.user_id)
                                    .query(`
                                        UPDATE bd
                                        SET bd.booking_status = @booking_status, 
                                            bd.toll_tax = @toll_tax, 
                                            bd.total_distance = @total_distance, 
                                            bd.duration = @duration, 
                                            bd.drop_lat = @drop_lat, 
                                            bd.drop_long = @drop_long, 
                                            bd.stop_time = GETDATE(), 
                                            bd.taxi_amout = @totalAmount
                                        FROM booking_detail AS bd
                                        WHERE bd.booking_id = @booking_id 
                                          AND bd.driver_id = @driver_id 
                                          AND bd.booking_status < @booking_status;
                                        UPDATE pd
                                        SET pd.amt = @totalAmount, 
                                            pd.driver_amt = @driverAmount, 
                                            pd.tax_amt = @taxAmount, 
                                            pd.ride_commission = @rideCommission, 
                                            pd.status = 1, 
                                            pd.payment_date = GETDATE()
                                        FROM payment_detail AS pd
                                        WHERE pd.payment_id IN (
                                            SELECT bd.payment_id FROM booking_detail bd WHERE bd.booking_id = @booking_id
                                        );
                                        UPDATE ud
                                        SET ud.status = 1
                                        FROM user_detail AS ud
                                        WHERE ud.user_id IN (
                                            SELECT bd.driver_id FROM booking_detail bd WHERE bd.booking_id = @booking_id
                                            UNION
                                            SELECT bd.user_id FROM booking_detail bd WHERE bd.booking_id = @booking_id
                                        );
                                    `);
                            })
                            .then((result) => {
                                if (result.rowsAffected[0] > 0 && result.rowsAffected[1] > 0 && result.rowsAffected[2] > 0) {
                                    // Send notification and emit socket events
                                    bookingInformationDetail(reqObj.booking_id, '2').then((result) => {
                                        if (result && result.length > 0) {
                                            const userSocket = controllerSocketList['us_' + result[0].user_id];
                                            
                                            if (userSocket && controllerIO.sockets.sockets.get(userSocket.socket_id)) {
                                                const responseObj = {
                                                    status: "1",
                                                    payload: {
                                                        booking_id: parseInt(reqObj.booking_id),
                                                        toll_tax: reqObj.toll_tax,
                                                        tax_amount: taxAmount,
                                                        amount: finalTotalAmount,
                                                        duration: durationString,
                                                        total_distance: totalKM,
                                                        payment_type: result[0].payment_type,
                                                        booking_status: bs_complete
                                                    },
                                                    message: "ride stop"
                                                };
                                                
                                                controllerIO.sockets.sockets.get(userSocket.socket_id).emit("ride_stop", responseObj);
                                            }
                                
                                            // Trigger OneSignal push notification
                                            oneSignalPushFire(1, [result[0].push_token], nt_t_5_ride_complete, "Ride Complete", {
                                                booking_id: reqObj.booking_id,
                                                toll_tax: reqObj.toll_tax,
                                                amount: finalTotalAmount.toString(),
                                                duration: durationString,
                                                total_distance: totalKM.toString(),
                                                payment_type: result[0].payment_type.toString(),
                                                booking_status: bs_complete.toString(),
                                                notification_id: nt_id_5_ride_complete
                                            });
                                
                                            // Send the response
                                            res.json({
                                                status: "1",
                                                payload: result[0],
                                                message: "Ride Complete Successfully"
                                            });
                                        }
                                    })
                                    .catch((error) => {
                                        console.error('Error fetching booking details:', error);
                                        // Handle error response if necessary
                                    });
                                }
                            })
                            .catch(err => {
                                helper.ThrowHtmlError(err, res);
                            });
                        });
                    } else {
                        res.json({
                            status: "0",
                            message: "Ride stop failed"
                        });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })
    })

    app.post('/api/home', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            var userCol = "user_id"
            if (uObj.user_type == ut_driver) {
                userCol = "driver_id"
            }
            
            sql.connect(config).then(pool => {
                return pool
                    .request()
                    .input('bs_complete', sql.Int, bs_complete)
                    .input('bs_pending', sql.Int, bs_pending)
                    .input('user_id', sql.Int, uObj.user_id)
                    .query(`
                        SELECT TOP 1 
                            bd.booking_id, 
                            bd.booking_status, 
                            bd.user_id, 
                            bd.driver_id 
                        FROM booking_detail AS bd 
                        WHERE bd.booking_status < @bs_complete 
                          AND bd.booking_status > @bs_pending 
                          AND ${userCol} = @user_id
                    `);
            })
            .then(result => {
                if (result.recordset.length > 0) {
                    const bookingId = result.recordset[0].booking_id;
 
                    bookingInformationDetail(bookingId, uObj.user_type)
                        .then(resultDetails => {
                            helper.Dlog("---------- Home ------------");
                            helper.Dlog(resultDetails);
        
                            if (resultDetails.status !== 0) {
                                res.json({
                                    "status": "1",
                                    "payload": {
                                        "running": resultDetails[0]
                                    }
                                });
                            }
                        })
                        .catch(err => {
                            helper.Dlog(err, res);
                        });
                } else {
                    res.json({
                        "status": "1",
                        "payload": {
                            "running": {}
                        }
                    });
                }
            })
            .catch(err => {
                helper.Dlog(err, res);
            });    

        })
    })

    app.post('/api/driver_all_ride_list', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            const query = `
                        SELECT 
                            [bd].[booking_id], 
                            [bd].[pickup_address], 
                            [bd].[drop_address], 
                            [bd].[pickup_date], 
                            [bd].[accpet_time], 
                            [bd].[start_time], 
                            [bd].[stop_time], 
                            [bd].[total_distance], 
                            [bd].[duration], 
                            [bd].[toll_tax], 
                            [bd].[tip_amount], 
                            [bd].[booking_status], 
                            [sd].[service_name], 
                            (CASE 
                                WHEN [sd].[icon] != '' 
                                THEN CONCAT('${helper.ImagePath()}', [sd].[icon]) 
                                ELSE '' 
                            END) AS [icon], 
                            [sd].[color], 
                            [ppd].[payment_type], 
                            (CASE 
                                WHEN CAST([ppd].[amt] AS FLOAT) > 0 AND [bd].[booking_status] = @bs_complete THEN CAST([ppd].[amt] AS FLOAT)
                                WHEN CAST([ppd].[amt] AS FLOAT) > 0 AND [bd].[booking_status] = @bs_cancel THEN 0
                                WHEN CAST([ppd].[amt] AS FLOAT) <= 0 THEN 0
                                ELSE 0 
                            END) AS [amount], 
                            (CASE 
                                WHEN [bd].[booking_status] = 5 THEN CAST([ppd].[driver_amt] AS FLOAT)
                                ELSE 0 
                            END) AS [driver_amt], 
                            (CASE 
                                WHEN [bd].[status] = 5 THEN CAST([ppd].[ride_commission] AS FLOAT)
                                ELSE 0 
                            END) AS [ride_commission]
                        FROM [booking_detail] AS [bd]
                        INNER JOIN [service_detail] AS [sd] 
                            ON [sd].[service_id] = [bd].[service_id] 
                        INNER JOIN [price_detail] AS [pd] 
                            ON [pd].[price_id] = [bd].[price_id] 
                        INNER JOIN [payment_detail] AS [ppd] 
                            ON [ppd].[payment_id] = [bd].[payment_id] 
                        WHERE [bd].[driver_id] = @user_id 
                            AND ([bd].[booking_status] BETWEEN @bs_accept AND @bs_cancel) 
                            AND [bd].[status] = @status 
                        ORDER BY [bd].[booking_id] DESC
                    `;

                    // Prepare parameters
                    const params = {
                        bs_complete: bs_complete,
                        bs_cancel: bs_cancel,
                        user_id: uObj.user_id,
                        bs_accept: bs_accept,
                        status: '1'
                    };

                    sql.connect(config, err => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                            return;
                        }

                        const request = new sql.Request();
                        request.input('bs_complete', sql.Int, params.bs_complete);
                        request.input('bs_cancel', sql.Int, params.bs_cancel);
                        request.input('user_id', sql.Int, params.user_id);
                        request.input('bs_accept', sql.Int, params.bs_accept);
                        request.input('status', sql.VarChar, params.status);

                        request.query(query, (err, result) => {
                            if (err) {
                                helper.ThrowHtmlError(err, res);
                            } else {
                                let rTotalAmount = 0.0;
                                let totalAmount = 0.0;

                                result.recordset.forEach(bookingObj => {
                                    rTotalAmount += parseFloat(bookingObj.amount);
                                    totalAmount += parseFloat(bookingObj.driver_amt);
                                });

                                res.json({
                                    status: '1',
                                    payload: {
                                        ride_list: result.recordset,
                                        driver_total: totalAmount,
                                        total: rTotalAmount
                                    }
                                });
                            }
                        });
                    });
        }, ut_driver)

    })

    app.post('/api/user_all_ride_list', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {

                const query = `
                SELECT 
                    [bd].[booking_id], 
                    [bd].[pickup_address], 
                    [bd].[drop_address], 
                    [bd].[pickup_date], 
                    [bd].[accpet_time], 
                    [bd].[start_time], 
                    [bd].[stop_time], 
                    [bd].[est_total_distance], 
                    [bd].[est_duration], 
                    [bd].[total_distance], 
                    [bd].[duration], 
                    [bd].[booking_status], 
                    [sd].[service_name], 
                    (CASE 
                        WHEN [sd].[icon] != '' 
                        THEN CONCAT('${helper.ImagePath()}', [sd].[icon]) 
                        ELSE '' 
                    END) AS [icon], 
                    [sd].[color] 
                FROM [booking_detail] AS [bd]
                INNER JOIN [service_detail] AS [sd] 
                    ON [sd].[service_id] = [bd].[service_id] 
                WHERE [bd].[user_id] = @user_id 
                    AND [bd].[status] = @status 
                ORDER BY [bd].[booking_id] DESC
            `;

            // Prepare parameters
            const params = {
                user_id: uObj.user_id,
                status: '1'
            };

            sql.connect(config, err => {
                if (err) {
                    helper.ThrowHtmlError(err, res);
                    return;
                }
            
                const request = new sql.Request();
                request.input('user_id', sql.Int, params.user_id);  // Make sure user_id type matches
                request.input('status', sql.VarChar, params.status);
            
                request.query(query, (err, result) => {
                    if (err) {
                        helper.ThrowHtmlError(err, res);
                    } else {
                        res.json({
                            status: '1',
                            payload: result.recordset
                        });
                    }
                });
            });
        }, ut_user)

    })

    app.post('/api/ride_rating', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["booking_id", "rating", "comment"], () => {
                //User calling this api then save driver rating
                //Driver Calling this api then save user rating

                let sqlQuery = "UPDATE booking_detail SET driver_rating = @rating, driver_comment = @comment WHERE booking_id = @booking_id AND user_id = @user_id AND booking_status = @booking_status";

                if (uObj.user_type == ut_driver) {
                    sqlQuery = "UPDATE booking_detail SET user_rating = @rating, user_comment = @comment WHERE booking_id = @booking_id AND driver_id = @user_id AND booking_status = @booking_status";
                }

                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('rating', sql.Int, reqObj.rating)
                        .input('comment', sql.NVarChar, reqObj.comment)
                        .input('booking_id', sql.Int, reqObj.booking_id)
                        .input('user_id', sql.Int, uObj.user_id)
                        .input('booking_status', sql.Int, bs_complete)
                        .query(sqlQuery);
                }).then(result => {
                    if (result.rowsAffected > 0) {
                        res.json({
                            'status': "1",
                            "message": "Thanks for rating"
                        });
                    } else {
                        res.json({
                            'status': "0",
                            "message": msg_fail
                        });
                    }
                }).catch(err => {
                    helper.ThrowHtmlError(err, res);
                });

            })
        })
    })

    app.post('/api/driver_summary', (req, res) => {

        helper.Dlog(req.body)
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            const sqlQuery = `
                    SELECT bd.booking_id, bd.driver_id, bd.pickup_address, bd.start_time, pd.amt, pd.payment_type 
                    FROM booking_detail AS bd
                    INNER JOIN payment_detail AS pd ON bd.payment_id = pd.payment_id AND bd.booking_status = @booking_status AND bd.driver_id = @driver_id 
                    WHERE CAST(bd.start_time AS DATE) = CAST(GETDATE() AS DATE);

                    SELECT bd.booking_id, bd.driver_id, bd.pickup_address, bd.start_time, pd.amt, pd.payment_type 
                    FROM booking_detail AS bd
                    INNER JOIN payment_detail AS pd ON bd.payment_id = pd.payment_id AND bd.booking_status = @booking_status AND bd.driver_id = @driver_id
                    WHERE CAST(bd.start_time AS DATE) <= CAST(GETDATE() AS DATE) AND CAST(bd.start_time AS DATE) >= DATEADD(DAY, -7, GETDATE());

                    SELECT dt.date, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL THEN 1 ELSE 0 END) AS trips_count, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL THEN CAST(pd.amt AS FLOAT) ELSE 0.0 END) AS total_amt, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL AND pd.payment_type = 1 THEN CAST(pd.amt AS FLOAT) ELSE 0.0 END) AS cash_amt, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL AND pd.payment_type = 2 THEN CAST(pd.amt AS FLOAT) ELSE 0.0 END) AS online_amt 
                    FROM booking_detail AS bd
                    INNER JOIN payment_detail AS pd ON bd.payment_id = pd.payment_id AND bd.booking_status = 5 AND bd.driver_id = @driver_id
                    AND CAST(bd.start_time AS DATE) <= CAST(GETDATE() AS DATE) AND CAST(bd.start_time AS DATE) >= DATEADD(DAY, -7, GETDATE())
                    RIGHT JOIN (
                        SELECT CAST(DATEADD(DAY, -C.daynum, GETDATE()) AS DATE) AS date 
                        FROM ( 
                            SELECT t * 10 + u AS daynum 
                            FROM (SELECT 0 AS t UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) AS A, 
                            (SELECT 0 AS u UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) AS B
                        ) AS C 
                        WHERE C.daynum < 7 
                    ) AS dt ON dt.date = CAST(bd.start_time AS DATE) 
                    GROUP BY dt.date
					ORDER BY date;
                `;

                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('booking_status', sql.Int, bs_complete)
                        .input('driver_id', sql.Int, uObj.user_id)
                        .query(sqlQuery);
                }).then(result => {
                    const totalAmt = result.recordsets[0].reduce((total, obj) => total + parseFloat(obj.amt), 0);
                    const cashAmt = result.recordsets[0].reduce((total, obj) => obj.payment_type === 1 ? total + parseFloat(obj.amt) : total, 0);
                    const onlineAmt = result.recordsets[0].reduce((total, obj) => obj.payment_type === 2 ? total + parseFloat(obj.amt) : total, 0);

                    const wTotalAmt = result.recordsets[1].reduce((total, obj) => total + parseFloat(obj.amt), 0);
                    const wCashAmt = result.recordsets[1].reduce((total, obj) => obj.payment_type === 1 ? total + parseFloat(obj.amt) : total, 0);
                    const wOnlineAmt = result.recordsets[1].reduce((total, obj) => obj.payment_type === 2 ? total + parseFloat(obj.amt) : total, 0);

                    res.json({
                        'status': "1",
                        "payload": {
                            'today': {
                                'trips_count': result.recordsets[0].length,
                                'total_amt': totalAmt,
                                'cash_amt': cashAmt,
                                'online_amt': onlineAmt,
                                'list': result.recordsets[0]
                            },
                            'week': {
                                'trips_count': result.recordsets[1].length,
                                'total_amt': wTotalAmt,
                                'cash_amt': wCashAmt,
                                'online_amt': wOnlineAmt,
                                'list': result.recordsets[1],
                                'chart': result.recordsets[2],
                            }
                        }
                    });
                }).catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
        }, ut_driver)

    } )

    app.post('/api/driver_summary_daily_amount', (req, res) => {

        helper.Dlog(req.body)
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            const sqlQuery = `
                    SELECT dt.date, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL THEN 1 ELSE 0 END) AS trips_count, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL THEN CAST(pd.amt AS FLOAT) ELSE 0.0 END) AS total_amt, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL AND pd.payment_type = 1 THEN CAST(pd.amt AS FLOAT) ELSE 0.0 END) AS cash_amt, 
                        SUM(CASE WHEN bd.booking_id IS NOT NULL AND pd.payment_type = 2 THEN CAST(pd.amt AS FLOAT) ELSE 0.0 END) AS online_amt 
                    FROM booking_detail AS bd
                    INNER JOIN payment_detail AS pd ON bd.payment_id = pd.payment_id AND bd.booking_status = 5 AND bd.driver_id = @driver_id
                    AND CAST(bd.start_time AS DATE) <= CAST(GETDATE() AS DATE) AND CAST(bd.start_time AS DATE) >= DATEADD(DAY, -7, GETDATE())
                    RIGHT JOIN (
                        SELECT CAST(DATEADD(DAY, -C.daynum, GETDATE()) AS DATE) AS date 
                        FROM ( 
                            SELECT t * 10 + u AS daynum 
                            FROM (SELECT 0 AS t UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) AS A, 
                            (SELECT 0 AS u UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) AS B
                        ) AS C 
                        WHERE C.daynum < 1 
                    ) AS dt ON dt.date = CAST(bd.start_time AS DATE) 
                    GROUP BY dt.date
					ORDER BY date;
                `;

                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('driver_id', sql.Int, uObj.user_id)
                        .query(sqlQuery);
                }).then(result => {
                    const totalAmt = result.recordsets[0].reduce((total, obj) => total + parseFloat(obj.amt), 0);
                    const cashAmt = result.recordsets[0].reduce((total, obj) => obj.payment_type === 1 ? total + parseFloat(obj.amt) : total, 0);
                    const onlineAmt = result.recordsets[0].reduce((total, obj) => obj.payment_type === 2 ? total + parseFloat(obj.amt) : total, 0);

                    res.json({
                        'status': "1",
                        "payload": result.recordsets[0]
                    });
                }).catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
        }, ut_driver)

    } )
    

}

function driverUserWaitingTimeOver(booking_id, time) {
    var oneTimeCron = setTimeout(function () {
        removeDriverWaitUser(booking_id)
    }, time * 1000)

    driverUserWaitingArray['bk_' + booking_id] = oneTimeCron;
}

function removeDriverWaitUser(booking_id) {
    clearTimeout(driverUserWaitingArray['bk_' + booking_id])
    delete driverUserWaitingArray['bk_' + booking_id]
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

function driverNewRequestSend(bookingDetail, callback) {
    //`bd`.`pickup_lat`, `bd`.`pickup_long`,
    var latitude = parseFloat(bookingDetail.pickup_lat)
    var longitude = parseFloat(bookingDetail.pickup_long)

    helper.findNearByLocation(latitude, longitude, 3, (minLat, maxLat, minLng, maxLng) => {
        var allReadySendRequest = bookingDetail.request_driver_id
        if (allReadySendRequest == "") {
            allReadySendRequest = "''"
        }

        sql.connect(config).then((pool) => {
            return pool
              .request()
              .input('service_id', sql.Int, bookingDetail.service_id)
              .input('price_id', sql.Int, bookingDetail.price_id)
              .input('pickup_date', sql.VarChar, helper.serverMySqlDate(bookingDetail.pickup_date, 'YYYY-MM-DD'))
              .input('pickup_date_with_time', sql.VarChar, helper.serverMySqlDate(bookingDetail.pickup_date, 'YYYY-MM-DD HH:mm:ss'))
              .input('pickup_date_with_time_adjusted', sql.VarChar, helper.serverDateTimeAddMin(bookingDetail.pickup_date, 'YYYY-MM-DD HH:mm:ss', newRequestTimeABC))
              .input('bs_complete', sql.Int, bs_complete)
              .query(`
                SELECT ud.user_id, ud.device_source, ud.push_token, ud.lati, ud.longi
                FROM user_detail AS ud
                INNER JOIN zone_document AS zd ON zd.zone_id = ud.zone_id 
                  AND zd.service_id = @service_id 
                  AND CHARINDEX(CAST(zd.service_id AS NVARCHAR), ud.select_service_id) != 0
                INNER JOIN price_detail AS pm ON pm.zone_id = zd.zone_id 
                  AND pm.price_id = @price_id
                INNER JOIN zone_wise_cars_service AS zwcs ON ud.car_id = zwcs.user_car_id 
                  AND zwcs.zone_doc_id = zd.zone_doc_id
                WHERE ud.user_type = 2 
                  AND ud.status >= 1 
                  AND ud.is_online = 1 
                  AND ud.is_request_send = 0 
                  AND zwcs.expiry_date >= @pickup_date 
                  AND zwcs.status = 1 
                  AND zwcs.service_provide = 1 
                  AND (CAST(ud.lati AS FLOAT) BETWEEN ${minLat} AND ${maxLat}) 
                  AND (CAST(ud.longi AS FLOAT) BETWEEN ${minLng} AND ${maxLng}) 
                  AND ud.user_id NOT IN (${allReadySendRequest}) 
                  AND ud.user_id NOT IN (
                    SELECT driver_id 
                    FROM booking_detail 
                    WHERE pickup_date BETWEEN @pickup_date_with_time AND @pickup_date_with_time_adjusted 
                      AND booking_status < @bs_complete
                    GROUP BY driver_id
                  )
              `);
          })
          .then((result) => {
            const drivers = result.recordset;
        
            if (drivers.length > 0) {
              drivers.forEach((driverInfo, index) => {
                drivers[index].distance = helper.distance(latitude, longitude, driverInfo.lati, driverInfo.longi);
              });
        
              drivers.sort((a, b) => a.distance - b.distance); // Sort drivers by distance
        
              // Live Socket check
              for (let i = 0; i < drivers.length; i++) {
                const driverSocket = controllerSocketList['us_' + drivers[i].user_id];
                if (driverSocket && controllerIO.sockets.sockets.get(driverSocket.socket_id)) {
                  driverSendRequestFire(bookingDetail, drivers[i], true);
        
                  const response = {
                    status: "1",
                    payload: [bookingDetail],
                  };
        
                  controllerIO.sockets.sockets.get(driverSocket.socket_id).emit("new_ride_request", response);
                  return callback(1, bookingDetail);
                } else {
                  helper.Dlog("Driver socket client not connected");
                  helper.Dlog(drivers[i]);
                }
              }
        
              // If no live socket, send request to the first nearby driver as a notification
              helper.Dlog("New request push notification fire");
              driverSendRequestFire(bookingDetail, drivers[0], true);
              return callback(1, bookingDetail);
            } else {
              // No drivers available
              helper.Dlog("No driver available for booking: " + bookingDetail.accpet_driver_id);
        
              if (bookingDetail.accpet_driver_id) {
                // Recall driver not found
                sql.connect(config)
                  .then((pool) => {
                    return pool
                      .request()
                      .input('booking_id', sql.Int, bookingDetail.booking_id)
                      .query(`
                        UPDATE booking_detail 
                        SET driver_id = accpet_driver_id 
                        WHERE booking_id = @booking_id
                      `);
                  })
                  .then((result) => {
                    if (result.rowsAffected[0] > 0) {
                      helper.Dlog("Recall driver, no drivers found.");
                    } else {
                      helper.Dlog("Recall driver, no drivers found.");
                    }
                    return callback(2, "Recall driver not available");
                  })
                  .catch((err) => helper.ThrowHtmlError(err));
              } else {
                // No driver at all, update booking status
                sql.connect(config)
                  .then((pool) => {
                    return pool
                      .request()
                      .input('bs_no_driver', sql.Int, bs_no_driver)
                      .input('booking_id', sql.Int, bookingDetail.booking_id)
                      .query(`
                        UPDATE booking_detail 
                        SET booking_status = @bs_no_driver, stop_time = GETDATE() 
                        WHERE booking_id = @booking_id
                      `);
                  })
                  .then((result) => {
                    if (result.rowsAffected[0] > 0) {
                      helper.Dlog("Booking status updated to no driver.");
                    } else {
                      helper.Dlog("Booking status not updated.");
                    }
                    return callback(2, "Driver not available");
                  })
                  .catch((err) => helper.ThrowHtmlError(err));
              }
            }
          })
          .catch((err) => {
            helper.ThrowHtmlError(err);
          });         

    })

    //Driver Api



}

function driverSendRequestFire(bookingDetail, driverDetail, isSendNotification) {
    var requestToken = helper.createRequestToken()
    helper.Dlog(" --------- Request Token Create -------------");

    bookingDetail.driver_id = driverDetail.user_id;
    bookingDetail.request_token = requestToken;
    bookingDetail.request_accpet_time = requestAcceptTime

    var allReadySendRequest = bookingDetail.request_driver_id
    if (allReadySendRequest == "") {
        allReadySendRequest = driverDetail.user_id.toString()

    } else {
        allReadySendRequest = allReadySendRequest + ',' + driverDetail.user_id.toString()
    }

    sql.connect(config).then((pool) => {
        return pool
          .request()
          .input('driver_id', sql.Int, driverDetail.user_id)
          .input('request_driver_id', sql.VarChar, allReadySendRequest)
          .input('booking_id', sql.Int, bookingDetail.booking_id)
          .input('is_request_send', sql.Int, 1) // equivalent to '1' in MySQL
          .query(`
            UPDATE booking_detail 
            SET driver_id = @driver_id, request_driver_id = @request_driver_id 
            WHERE booking_id = @booking_id;
    
            UPDATE user_detail 
            SET is_request_send = @is_request_send 
            WHERE user_id = @driver_id;
          `);
      })
      .then((result) => {
        // MSSQL `rowsAffected` is an array, where each element indicates the affected rows of each statement in a batch
        if (result.rowsAffected[0] > 0 && result.rowsAffected[1] > 0) {
          helper.Dlog("DB Booking detail Update Successfully");
    
          // Corn Create Request => Get Feedback (accept, decline, timeout)
          driverSendRequestTimeOver(bookingDetail.booking_id, bookingDetail.driver_id, requestToken, requestWaitingAcceptTime);
        } else {
          // If either update failed
          helper.Dlog("DB Booking detail Update fail");
        }
      })
      .catch((err) => {
        helper.ThrowHtmlError(err);
      });
  

    if (isSendNotification) {

        //`bd`.`drop_lat`, `bd`.`drop_long`, `bd`.`drop_address`, `bd`.`pickup_date`, `bd`.`service_id`, `bd`.`price_id`, `bd`.`payment_id`, `bd`.`est_total_distance`, `bd`.`est_duration`,  `bd`.`created_date`, `bd`.`accpet_time`, `bd`.`start_time`, `bd`.`stop_time`, `bd`.`booking_status`, `bd`.`request_driver_id`, `pd`.`zone_id`, `pd`.`mini_km`, `sd`.`service_name`, `sd`.`color`, `sd`.`icon`, `ud`.`name`, `ud`.`mobile`, `ud`.`mobile_code`, `ud`.`push_token`, (CASE WHEN `ud`.`image` != ''  THEN CONCAT( '" + helper.ImagePath() + "' , `ud`.`image`  ) ELSE '' END) AS `image`, `ppd`.`amt`, `ppd`.`amt`, `ppd`.`payment_type`
        // OneSignal Push
        oneSignalPushFire(ut_driver, [driverDetail.push_token], nt_t_1_new_request, 'pickup location: ' + bookingDetail.pickup_address, {
            "booking_id": bookingDetail.booking_id,
            "request_token": requestToken,
            "service_name": bookingDetail.service_name,
            "color": bookingDetail.color,
            "name": bookingDetail.name,
            "pickup_date": helper.isoDate(helper.serverMySqlDate(bookingDetail.pickup_date)),
            "pickup_lat": bookingDetail.pickup_lat,
            "pickup_long": bookingDetail.pickup_long,
            "pickup_date": helper.isoDate(helper.serverMySqlDate(bookingDetail.pickup_date)),
            "drop_lat": bookingDetail.pickup_lat,
            "drop_long": bookingDetail.pickup_long,
            "pickup_address": bookingDetail.pickup_address,
            "drop_address": bookingDetail.drop_address,
            "amt": bookingDetail.amt,
            "payment_type": bookingDetail.payment_type,
            "notification_id": nt_id_1_new_request,

            "est_total_distance": bookingDetail.est_total_distance, "est_duration": bookingDetail.est_duration,
            "pickup_accpet_time": bookingDetail.request_accpet_time,
            "request_time_out": helper.serverDateTimeAddMin(bookingDetail.request_accpet_time),

        });

    }

}

function driverSendRequestTimeOver(bookingId, driverId, requestToken, time) {

    var oneTimeCron = setTimeout(() => {
        helper.Dlog(" -------------- oneTime Cron Request Accept TimeOver(" + time + ")");
        sql.connect(config).then((pool) => {
            return pool
              .request()
              .input('is_request_send', sql.Int, 0) // equivalent to '0' in MySQL
              .input('user_id', sql.Int, driverId)   // assuming driverId is an integer
              .query('UPDATE user_detail SET is_request_send = @is_request_send WHERE user_id = @user_id');
          })
          .then((result) => {
            // SQL Server's `rowsAffected` is an array, and we need to check if the first element is greater than 0
            if (result.rowsAffected[0] > 0) {
              helper.Dlog("Driver id change success : " + driverId);
              // Find New Driver And Send Request this booking id
              driverNewRequestSendByBookingID(bookingId);
            } else {
              helper.Dlog("Driver id change fail: " + driverId);
            }
        
            removeRequestTokenPendingArr(requestToken);
          })
          .catch((err) => {
            helper.ThrowHtmlError(err);
          });  
    }, time * 1000)
    requestPendingArray[requestToken] = oneTimeCron;

}

function removeRequestTokenPendingArr(token) {
    clearTimeout(requestPendingArray[token]);
    delete requestPendingArray[token];
    helper.Dlog("Delete Request Token: " + token);
    helper.Dlog(requestPendingArray);
}

function driverNewRequestSendByBookingID(bookingID) {
    helper.Dlog("---------------- Other Driver Request Send Processing -----------------")
    sql.connect(config).then((pool) => {
        return pool
          .request()
          .input('bookingID', sql.Int, bookingID)
          .input('bs_pending', sql.Int, bs_pending)
          .input('bs_start', sql.Int, bs_start)
          .query(`
            SELECT bd.booking_id, bd.driver_id, bd.user_id, bd.pickup_lat, bd.pickup_long, bd.pickup_address, 
                   bd.drop_lat, bd.drop_long, bd.drop_address, bd.pickup_date, bd.service_id, bd.price_id, 
                   bd.payment_id, bd.est_total_distance, bd.est_duration, bd.created_date, bd.accpet_time, 
                   bd.start_time, bd.stop_time, bd.booking_status, bd.request_driver_id, bd.accpet_driver_id, pd.zone_id, pd.mini_km, 
                   sd.service_name, sd.color, sd.icon, ud.name, ud.mobile, ud.mobile_code, ud.push_token, 
                   (CASE WHEN ud.image != '' THEN CONCAT('` + helper.ImagePath() + `', ud.image) ELSE '' END) AS image, 
                   ppd.amt, ppd.driver_amt, ppd.payment_type 
            FROM booking_detail AS bd
            INNER JOIN user_detail AS ud ON ud.user_id = bd.user_id
            INNER JOIN price_detail AS pd ON pd.price_id = bd.price_id
            INNER JOIN payment_detail AS ppd ON ppd.payment_id = bd.payment_id
            INNER JOIN service_detail AS sd ON sd.service_id = bd.service_id
            WHERE bd.booking_id = @bookingID 
            AND (bd.booking_status = @bs_pending 
                 OR (bd.booking_status < @bs_start AND bd.accpet_driver_id != ''))
          `);
      })
      .then((result) => {
        if (result.recordset.length > 0) {
          driverNewRequestSend(result.recordset[0], (status, bookingInfo) => {
            if (status == 2) {
              if (result.recordset[0].accpet_driver_id === "") {
                // New Booking Request No Driver Found
                let userSocket = controllerSocketList['us_' + result.recordset[0].user_id];
                if (userSocket && controllerIO.sockets.sockets.get(userSocket.socket_id)) {
                  let response = {
                    "status": "1",
                    "payload": {
                      "booking_id": bookingID,
                      "booking_status": bs_no_driver,
                    },
                    "message": "driver not available"
                  };
                  controllerIO.sockets.sockets.get(userSocket.socket_id).emit("driver_not_available", response);
                }
              } else {
                // Recall Driver Not Found
                let driverSocket = controllerSocketList['us_' + result.recordset[0].accpet_driver_id];
                if (driverSocket && controllerIO.sockets.sockets.get(driverSocket.socket_id)) {
                  let response = {
                    "status": "1",
                    "payload": {
                      "booking_id": bookingID,
                      "booking_status": bs_no_driver,
                    },
                    "message": "Recall driver not available"
                  };
                  controllerIO.sockets.sockets.get(driverSocket.socket_id).emit("driver_not_available", response);
                }
    
                // Check for driver's push token
                sql.connect(config)
                  .then((pool) => {
                    return pool
                      .request()
                      .input('accpet_driver_id', sql.Int, bookingInfo.accpet_driver_id)
                      .query(`
                        SELECT user_id, push_token 
                        FROM user_detail 
                        WHERE user_id = @accpet_driver_id
                      `);
                  })
                  .then((driverResult) => {
                    if (driverResult.recordset.length > 0) {
                      oneSignalPushFire(ut_driver, [driverResult.recordset[0].push_token], nt_t_7_drive_no_available, "Recall driver not available", {
                        "booking_id": bookingInfo.booking_id,
                        "notification_id": nt_id_7_drive_no_available,
                      });
                    }
                  })
                  .catch((err) => helper.ThrowHtmlError(err));
              }
            }
          });
        } else {
          helper.Dlog("Not Booking info get");
        }
      })
      .catch((err) => helper.ThrowHtmlError(err));
  
}

function userRideCancel(booking_id, booking_status, user_id, user_type, isForce, callback) {
    var rideCancelTime = helper.serverYYYYMMDDHHmmss()
    var id = "user_id"
    var checkTime = "accpet_time"
    var response = "";
    var isDriverCancel = '0';

    if (user_type == ut_driver) {
        id = "driver_id"
        checkTime = "start_time"
        isDriverCancel = "1"
    }

    var condition = ""

    if (isForce) {
        condition = ""
    } else {
        condition = " AND bd.booking_status = '" + booking_status + "' ";
    }

    var sqlQry = ""

    if (booking_status == bs_go_user || booking_status == bs_wait_user) {
        sqlQry = `UPDATE bd
                SET bd.booking_status = @bs_cancel, 
                    bd.is_driver_cancel = @isDriverCancel, 
                    bd.stop_time = GETDATE()
                FROM booking_detail AS bd
                WHERE bd.booking_id = @booking_id 
                AND bd.${id} = @user_id 
                AND bd.booking_status <= @statusCondition
                ${condition};
                UPDATE ud
                SET ud.status = '1',
                ud.is_request_send=0
                FROM user_detail AS ud
                INNER JOIN booking_detail AS bd ON bd.driver_id = ud.user_id
                WHERE bd.booking_id = @booking_id;
                UPDATE uud
                SET uud.status = '1',
                uud.is_request_send=0
                FROM user_detail AS uud
                INNER JOIN booking_detail AS bd ON bd.user_id = uud.user_id
                WHERE bd.booking_id = @booking_id;
                `;
    } else {
        sqlQry = `UPDATE bd
                SET bd.booking_status = @bs_cancel, 
                    bd.is_driver_cancel = @isDriverCancel, 
                    bd.stop_time = GETDATE()
                FROM booking_detail AS bd
                WHERE bd.booking_id = @booking_id 
                AND bd.${id} = @user_id 
                AND bd.booking_status <= @statusCondition 
                ${condition};
                UPDATE ud
                SET ud.status = '1',
                ud.is_request_send=0
                FROM user_detail AS ud
                INNER JOIN booking_detail AS bd ON bd.driver_id = ud.user_id
                WHERE bd.booking_id = @booking_id;
                UPDATE uud
                SET uud.status = '1',
                uud.is_request_send=0
                FROM user_detail AS uud
                INNER JOIN booking_detail AS bd ON bd.user_id = uud.user_id
                WHERE bd.booking_id = @booking_id;
                `;
    }

    helper.Dlog(sqlQry);
    sql.connect(config).then((pool) => {
        return pool
          .request()
          .input('bs_cancel', sql.Int, bs_cancel)
          .input('isDriverCancel', sql.Int, isDriverCancel)
          .input('booking_id', sql.Int, booking_id)
          .input('user_id', sql.Int, user_id)
          .input('statusCondition', sql.Int, isForce ? 8 : bs_start)
          .query(sqlQry);
      })
      .then((result) => {
        if (result.rowsAffected[0] > 0) {
          if (booking_status > bs_pending) {
            // Accepted: Proceed with booking information and notification
            bookingInformation(booking_id, user_type, (status, result) => {
              if (status === 1) {
                helper.timeDuration(rideCancelTime, helper.serverMySqlDate(result[0][checkTime]), (totalMin, durationString) => {
                  if (booking_status >= bs_go_user && booking_status <= bs_wait_user) {
                    // Handle user-specific logic for status between `bs_go_user` and `bs_wait_user`
                  }
    
                  let emit = "user_cancel_ride";
                  let driverSocket;
                  let notificationType = ut_driver;
                  let noti_message = nt_t_6_ride_cancel;
    
                  if (user_type === 2) {
                    emit = "driver_cancel_ride";
                    driverSocket = controllerSocketList['us_' + result[0].user_id];
                    notificationType = ut_user;
                    noti_message = nt_t_6_ride_cancel;
                  } else {
                    driverSocket = controllerSocketList['us_' + result[0].driver_id];
                  }
    
                  const response = {
                    'status': "1",
                    "payload": {
                      "booking_id": parseInt(booking_id),
                      "booking_status": bs_cancel,
                    },
                    "message": noti_message,
                  };
    
                  if (driverSocket && controllerIO.sockets.sockets.get(driverSocket.socket_id)) {
                    controllerIO.sockets.sockets.get(driverSocket.socket_id).emit(emit, response);
                    helper.Dlog("Ride Cancel Node Notification sent -----" + emit);
                  } else {
                    helper.Dlog("Ride Cancel Node Notification User not connected -----" + emit);
                  }
    
                  oneSignalPushFire(notificationType, [result[0].push_token], nt_t_6_ride_cancel, noti_message, {
                    "booking_id": parseInt(booking_id).toString(),
                    "booking_status": bs_cancel.toString(),
                    "notification_id": nt_id_6_ride_cancel,
                  });
    
                  return callback({
                    "status": "1",
                    "message": "Ride Cancelled successfully",
                    "payload": {
                      "booking_id": parseInt(booking_id),
                      "booking_status": bs_cancel,
                    },
                  });
                });
              } else {
                return callback({
                  "status": "0",
                  "message": "Ride cancel failed",
                });
              }
            });
          } else {
            // Ride Not Accepted: Respond with successful cancellation
            return callback({
              "status": "1",
              "message": "Ride Cancelled successfully",
              "payload": {
                "booking_id": parseInt(booking_id),
                "booking_status": bs_cancel,
              },
            });
          }
        } else {
          // Query affected no rows, cancel failed
          return callback({
            "status": "0",
            "message": "Ride cancel failed",
          });
        }
      })
      .catch((err) => helper.ThrowHtmlError(err));
  

}

function bookingInformation(booking_id, user_type, callback) {
    var userId = "user_id"

    switch (user_type) {
        case 1, '1':
            userId = "driver_id"
            break;
        case 2, '2':
            userId = "user_id"
            break;
        default:
            userId = "driver_id"
            break;
    }

    sql.connect(config).then((pool) => {
        // Replace the userId and booking_id with parameters
        return pool
            .request()
            .input('userId', sql.VarChar, userId) // Assumed to be an integer, adjust type as needed
            .input('booking_id', sql.VarChar, booking_id) // Adjust type based on how booking_id is used
            .query(`
                SELECT bd.*,sd.*,pd.*,pm.*,zl.*,ud.name,ud.gender,uud.email,ud.mobile,ud.lati,ud.longi,ud.user_type,ud.push_token, 
                    cs.series_name,cm.model_name,cb.brand_name,ucd.car_number,pd.status AS payment_status
                FROM booking_detail AS bd
                INNER JOIN user_detail AS ud ON ud.user_id = bd.` + userId + `
                INNER JOIN user_detail AS uud ON uud.user_id = bd.user_id
                INNER JOIN service_detail AS sd ON sd.service_id = bd.service_id
                INNER JOIN payment_detail AS pd ON pd.payment_id = bd.payment_id
                INNER JOIN price_detail AS pm ON pm.price_id = bd.price_id
                INNER JOIN zone_list AS zl ON pm.zone_id = zl.zone_id
                LEFT JOIN user_cars AS ucd ON ucd.user_car_id = bd.user_car_id
                LEFT JOIN car_series AS cs ON cs.series_id = ucd.series_id
                LEFT JOIN car_model AS cm ON cm.model_id = cs.model_id
                LEFT JOIN car_brand AS cb ON cb.brand_id = cs.brand_id
                WHERE bd.booking_id IN (@booking_id)
            `);
    })
    .then((result) => {
        // Handle the result
        if (result.recordset.length > 0) {
            return callback(1, result.recordset);
        } else {
            return callback(0, "No Booking Information");
        }
    })
    .catch((err) => {
        // Handle any errors from the query
        helper.ThrowHtmlError(err);
    });

}

function bookingInformationDetail(booking_id, user_type) {
    return new Promise((resolve, reject) => {
        var userId = "user_id";
        var otp_condition = "";

        helper.Dlog(booking_id);

        switch (user_type) {
            case 2:
            case '2':
                userId = "user_id";
                break;
            default:
                userId = "driver_id";
                otp_condition = `
                    (CASE WHEN bd.booking_status <= ${bs_wait_user} 
                    THEN bd.otp_code ELSE '-' END) AS otp_code, `;
                break;
        }

        const query = `
            SELECT 
                bd.booking_id, bd.user_id, bd.pickup_lat, bd.pickup_long, bd.pickup_address, ${otp_condition}
                bd.drop_lat, bd.drop_long, bd.drop_address, bd.service_id, bd.price_id, bd.driver_id, 
                bd.driver_rating, bd.driver_comment, bd.user_rating, bd.user_comment, bd.total_distance, 
                bd.accpet_time, bd.payment_id, bd.start_time, bd.stop_time, bd.duration, bd.toll_tax, bd.tip_amount, 
                bd.booking_status, bd.est_total_distance, bd.est_duration, pm.mini_km, ud.name, ud.push_token, 
                ud.gender, ud.mobile, ud.mobile_code, ud.lati, ud.longi, 
                (CASE WHEN ud.image != '' THEN CONCAT('${helper.ImagePath()}', ud.image) ELSE '' END) AS image, 
                pd.payment_type, pd.amt, pd.payment_date, pd.tax_amt, pd.pay_amt, pd.pay_card_amt, 
                pd.driver_amt, pd.pay_wallet_amt, pd.status AS user_payment_status, sd.service_name, sd.color, 
                (CASE WHEN sd.top_icon != '' THEN CONCAT('${helper.ImagePath()}', sd.top_icon) ELSE '' END) AS top_icon, 
                (CASE WHEN sd.icon != '' THEN CONCAT('${helper.ImagePath()}', sd.icon) ELSE '' END) AS icon, 
                cs.series_name, cm.model_name, cb.brand_name, ucd.car_number, pd.status AS payment_status 
            FROM booking_detail AS bd
            INNER JOIN user_detail AS ud ON ud.user_id = bd.${userId}
            INNER JOIN user_detail AS uud ON uud.user_id = bd.user_id
            INNER JOIN service_detail AS sd ON sd.service_id = bd.service_id
            INNER JOIN payment_detail AS pd ON pd.payment_id = bd.payment_id
            INNER JOIN price_detail AS pm ON pm.price_id = bd.price_id
            INNER JOIN zone_list AS zl ON pm.zone_id = zl.zone_id
            LEFT JOIN user_cars AS ucd ON ucd.user_car_id = bd.user_car_id
            LEFT JOIN car_series AS cs ON cs.series_id = ucd.series_id
            LEFT JOIN car_model AS cm ON cm.model_id = cs.model_id
            LEFT JOIN car_brand AS cb ON cb.brand_id = cs.brand_id
            WHERE bd.booking_id = @booking_id`;

        helper.Dlog(query);

        sql.connect(config)
            .then(pool => {
                return pool
                    .request()
                    .input('booking_id', sql.Int, booking_id)
                    .query(query);
            })
            .then(result => {
                if (result.recordset.length > 0) {
                    resolve(result.recordset);
                } else {
                    resolve({ status: 0, message: "No Booking Information" });
                }
            })
            .catch(err => {
                helper.ThrowHtmlError(err);
                reject(err);
            });
    });
}

async function oneSignalPushFire(userType, token, title, message, messageData = {}) {

    messageData = convertValuesToString(messageData);

    const accessToken = await getAccessToken();
    const fcmUrl = 'https://fcm.googleapis.com/v1/projects/plataformatransporte-b20ba/messages:send';

    const payload = JSON.stringify({
        message: {
            token: ""+ token +"",
            notification: {
                title: ""+ title +"",
                body: ""+ message +""
            },
            data : messageData,
            android: {
                priority: "high"
            },
            apns: {
                headers: {
                    "apns-priority": "10"
                },
                payload: {
                aps: {
                    alert: {
                    title: "Test Notification",
                    body: "This is a test message"
                    },
                    sound: "default",
                    badge: 1
                }
                }
            }
        }
    });

    const xhr = new XMLHttpRequest();

    xhr.open('POST', fcmUrl, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            helper.Dlog('Successfully sent message:', xhr.responseText);
        } else {
            console.error('Error sending message:', xhr.responseText);
        }
    };

    xhr.onerror = function () {
        console.error('Request failed');
    };

    xhr.send(payload);
}

async function getAccessToken() {

    const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];

    const auth = new GoogleAuth({
        keyFile: './helpers/plataformatransporte-b20ba-firebase-adminsdk-sldmg-37ecfb78f8.json',
        scopes: SCOPES
    });

    const accessToken = await auth.getAccessToken();
    return accessToken;
}

function convertValuesToString(messageData) {
    
    function recursiveStringify(messageData) {
        for (let key in messageData) {
            if (typeof messageData[key] === 'object' && messageData[key] !== null) {
                recursiveStringify(messageData[key]);
            } else {
                messageData[key] = String(messageData[key]);
            }
        }
    }

    recursiveStringify(messageData);

    return messageData;
}