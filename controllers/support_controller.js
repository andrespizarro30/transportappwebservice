var db = require('./../helpers/db_helpers')
var helper = require('./../helpers/helpers')
var multiparty = require('multiparty')
var fs = require('fs');
var imageSavePath = "./public/img/"

var sql = require('mssql');

// const config = {
//     user: 'andresp',
//     password: '123456',
//     server: '192.168.10.21',
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

//User Type:
const ut_admin = 4
const ut_driver = 2
const ut_user = 1

module.exports.controller = (app, io, socket_list, admin) => {

    const msg_success = "successfully";
    const msg_fail = "fail";
    const msg_invalidUser = "invalid username";

    //App Api

    app.post('/api/support_user_list', (req, res) => {
        helper.Dlog(req.body);
        var reqObj =  req.body;
        checkAccessToken( req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, [ "socket_id"] , () => {
                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('user_type', sql.Int, ut_admin)
                        .input('user_id', sql.Int, uObj.user_id)
                        .query(
                            `SELECT ud.user_id, 'App Support' AS name, 
                            (CASE WHEN ud.image != '' THEN CONCAT('${helper.ImagePath}', ud.image,'${helper.ImagePathToken}') ELSE '' END) AS image, '' AS message, 0 AS message_type, 
                            GETDATE() AS created_date, 0 AS base_count 
                            FROM user_detail AS ud WHERE ud.user_type = @user_type;

                            SELECT ud.user_id, ud.name, 
                            (CASE WHEN ud.image != '' THEN CONCAT('${helper.ImagePath}', ud.image,'${helper.ImagePathToken}') ELSE '' END) AS image, 
                            ISNULL(cm.message, '') AS message, ISNULL(cm.message_type, 0) AS message_type, ISNULL(cm.created_date, GETDATE()) AS created_date, 
                            ISNULL(bc.base_count, 0) AS base_count 
                            FROM user_detail AS ud 
                            INNER JOIN (
                                SELECT created_date, message_type, message, 
                                (CASE WHEN sender_id = @user_id THEN receiver_id ELSE sender_id END) AS user_id 
                                FROM chat_message 
                                WHERE chat_id IN (
                                    SELECT MAX(chat_id) FROM chat_message 
                                    WHERE status < 3 AND (sender_id = @user_id OR (receiver_id = @user_id AND status > -1)) 
                                    GROUP BY (CASE WHEN sender_id = @user_id THEN receiver_id ELSE sender_id END)
                                )
                            ) AS cm ON cm.user_id = ud.user_id 
                            LEFT JOIN (
                                SELECT COUNT(chat_id) AS base_count, sender_id AS user_id 
                                FROM chat_message 
                                WHERE receiver_id = @user_id AND status = 0 
                                GROUP BY sender_id
                            ) AS bc ON cm.user_id = bc.user_id 
                            WHERE ud.status = 1 
                            ORDER BY cm.created_date DESC`
                        );
                })
                .then(result => {
                    let adminArr = [];
            
                    if (result.recordsets[0].length > 0) {
                        adminArr = result.recordsets[1].filter(uObj => result.recordsets[0][0].user_id === uObj.user_id);
            
                        // If admin support user not found in chat messages
                        if (adminArr.length === 0) {
                            // Insert admin support data into the result
                            result.recordsets[1].unshift(result.recordsets[0][0]);
                        }
                    }
            
                    res.json({
                        'status': "1",
                        "payload": result.recordsets[1]
                    });
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            } )
        } )
    } )

    app.post('/api/support_connect', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["user_id", "socket_id"], () => {
                socket_list["us_" + uObj.user_id.toString()] = {
                    'socket_id': reqObj.socket_id
                };
                sql.connect(config).then(pool => {
                    // First query to get the created_date from chat_delete
                    return pool.request()
                        .input('user_id', sql.Int, uObj.user_id)
                        .input('receiver_id', sql.Int, reqObj.user_id)
                        .query('SELECT created_date FROM chat_delete WHERE user_id = @user_id AND receiver_id = @receiver_id;');
                })
                .then(result => {
                    let deleteMessageTime = "2024-01-01 00:00:00";
                    if (result.recordset.length > 0) {
                        deleteMessageTime = helper.serverMySqlDate(result.recordset[0].created_date, "YYYY-MM-DD HH:mm:ss");
                    }

                    let fecha = new Date(deleteMessageTime.replace(" ", "T"));
                    fecha.setHours(fecha.getHours() - 5);
                    fecha.setMinutes(fecha.getMinutes() - 30)
                    let año = fecha.getFullYear();
                    let mes = String(fecha.getMonth() + 1).padStart(2, '0');
                    let dia = String(fecha.getDate()).padStart(2, '0');
                    let horas = String(fecha.getHours()).padStart(2, '0');
                    let minutos = String(fecha.getMinutes()).padStart(2, '0');
                    let segundos = String(fecha.getSeconds()).padStart(2, '0');
                    deleteMessageTime = `${año}-${mes}-${dia} ${horas}:${minutos}:${segundos}`;
           
                    // Second query to get user info and chat messages
                    return sql.connect(config).then(pool => {
                        return pool.request()
                            .input('user_id', sql.Int, reqObj.user_id)
                            .input('deleteMessageTime', sql.DateTime, deleteMessageTime)
                            .input('user_id1', sql.Int, uObj.user_id)
                            .input('user_id2', sql.Int, reqObj.user_id)
                            .query(
                                `SELECT user_id, name, image FROM user_detail WHERE user_id = @user_id1;
                                SELECT chat_id, sender_id, receiver_id, message, created_date, message_type 
                                FROM chat_message WHERE created_date > '${deleteMessageTime}' 
                                AND ((sender_id = @user_id1 AND receiver_id = @user_id2) OR (sender_id = @user_id2 AND receiver_id = @user_id1)) 
                                ORDER BY chat_id ASC;`
                            );
                    });
                })
                .then(result => {
                    if (result.recordsets[0].length > 0) {
                        // Update query
                        return sql.connect(config).then(pool => {
                            return pool.request()
                                .input('sender_id', sql.Int, reqObj.user_id)
                                .input('receiver_id', sql.Int, uObj.user_id)
                                .query(
                                    'UPDATE chat_message SET status = 1, modify_date = GETDATE() ' +
                                    'WHERE sender_id = @sender_id AND receiver_id = @receiver_id AND status = 0;'
                                );
                        }).then(uResult => {
                            if (uResult.rowsAffected[0] > 0) {
                                helper.Dlog("User base reset done");
                            } else {
                                helper.Dlog("User base reset fail");
                            }
            
                            res.json({
                                "status": "1",
                                "payload": {
                                    "user_info": result.recordsets[0][0],
                                    "messages": result.recordsets[1]
                                }
                            });
                        });
                    } else {
                        res.json({
                            "status": "0",
                            "message": "invalid user"
                        });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })

    });

    app.post('/api/support_clear', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["receiver_id"], () => {
                sql.connect(config).then(pool => {
                    const request = pool.request();
            
                    // Update query
                    return request.input('user_id', sql.Int, uObj.user_id)
                        .input('receiver_id', sql.Int, reqObj.receiver_id)
                        .query(
                            'UPDATE chat_delete SET created_date = GETDATE() WHERE user_id = @user_id AND receiver_id = @receiver_id;'
                        );
                })
                .then(result => {
                    if (result.rowsAffected[0] > 0) {
                        res.json({ "status": "1", "message": msg_success });
                    } else {
                        // Insert query
                        return sql.connect(config).then(pool => {
                            const request = pool.request();
            
                            return request.input('user_id', sql.Int, uObj.user_id)
                                .input('receiver_id', sql.Int, reqObj.receiver_id)
                                .query(
                                    'INSERT INTO chat_delete (user_id, receiver_id, created_date) VALUES (@user_id, @receiver_id, GETDATE());'
                                );
                        }).then(insertResult => {
                            if (insertResult.rowsAffected[0] > 0) {
                                res.json({ "status": "1", "message": msg_success });
                            } else {
                                res.json({ "status": "0", "message": msg_fail });
                            }
                        });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })
    });

    app.post('/api/support_message', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["receiver_id", "message", "socket_id"], () => {
                socket_list["us_" + uObj.user_id.toString()] = {
                    'socket_id': reqObj.socket_id
                };

                var createdDate = helper.serverYYYYMMDDHHmmss()

                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('sender_id', sql.Int, uObj.user_id)
                        .input('receiver_id', sql.Int, reqObj.receiver_id)
                        .input('message', sql.NVarChar, reqObj.message)
                        .input('message_type', sql.Int, 0)
                        .input('user_id', sql.Int, uObj.user_id)
                        .query(
                            `INSERT INTO chat_message (sender_id, receiver_id, message, message_type) 
                            VALUES (@sender_id, @receiver_id, @message, @message_type); 
                            SELECT user_id, name, 
                            (CASE WHEN image != '' THEN CONCAT('${helper.ImagePath}', image,'${helper.ImagePathToken}') ELSE '' END) AS image, 
                            '' AS message, 0 AS message_type, GETDATE() AS created_date, 0 AS base_count 
                            FROM user_detail WHERE user_id = @user_id;`
                        );
                })
                .then(result => {
                    if (result.recordsets[0].length > 0) {
                        const chatId = "PENDING";
                        const dataMessage = {
                            chat_id: chatId,
                            sender_id: uObj.user_id,
                            receiver_id: parseInt(reqObj.receiver_id),
                            message: reqObj.message,
                            created_date: helper.isoDate(createdDate),
                            message_type: 0,
                        };
            
                        res.json({
                            status: "1",
                            payload: dataMessage,
                            message: msg_success,
                        });
            
                        // Emit event if the receiver is connected
                        const receiverSocket = socket_list['us_' + reqObj.receiver_id];
                        if (receiverSocket && io.sockets.sockets.get(receiverSocket['socket_id'])) {
                            io.sockets.sockets.get(receiverSocket.socket_id).emit("support_message", {
                                status: "1",
                                payload: [dataMessage],
                                user_info: result.recordsets[0].length > 0 ? result.recordsets[0][0] : {}
                            });
            
                            helper.Dlog("receiverSocket emit done");
                        } else {
                            helper.Dlog("receiverSocket client not connected");
                        }
                    } else {
                        res.json({
                            status: "0",
                            message: msg_fail
                        });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })

    });


}

function checkAccessToken(helperObj, res, callback, requireType = "") {
    helper.Dlog(helperObj.access_token)
    helper.CheckParameterValid(res, helperObj, ["access_token"], () => {
        sql.connect(config).then(pool => {
            return pool.request()
                .input('auth_token', sql.VarChar, helperObj.access_token)
                .input('status1', sql.VarChar, "1")
                .input('status2', sql.VarChar, "2")
                .query(
                    'SELECT user_id, name, email, gender, mobile, mobile_code, auth_token, user_type, is_block, image, status ' +
                    'FROM user_detail ' +
                    'WHERE auth_token = @auth_token AND (status = @status1 OR status = @status2);'
                );
        })
        .then(result => {
            if (result.recordset.length > 0) {
                if (requireType !== "") {
                    if (requireType === result.recordset[0].user_type) {
                        return callback(result.recordset[0]);
                    } else {
                        res.json({ "status": "0", "code": "404", "message": "Access denied. Unauthorized user access." });
                    }
                } else {
                    return callback(result.recordset[0]);
                }
            } else {
                res.json({ "status": "0", "code": "404", "message": "Access denied. Unauthorized user access." });
            }
        })
        .catch(err => {
            helper.ThrowHtmlError(err);
        });    
    })
}