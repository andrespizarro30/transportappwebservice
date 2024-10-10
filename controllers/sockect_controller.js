var helper = require('./../helpers/helpers')
//var db = require('./../helpers/db_helpers')
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

module.exports.controller = (app, io, socket_list) => {
    var response = '';

    const msg_success = "successfully";
    const msg_fail = "fail";
    const msg_invalidUser = "invalid username and password";

    io.on('connection', (client) => {
        client.on('UpdateSocket', (data) => {
            helper.Dlog('UpdateSocket :- ' + data);
            var jsonObj = JSON.parse(data);

            helper.CheckParameterValidSocket(client, "UpdateSocket",  jsonObj, ["access_token"], () => {
                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('auth_token', sql.VarChar, jsonObj.access_token)
                        .query('SELECT user_id, email FROM user_detail WHERE auth_token = @auth_token;');
                })
                .then(result => {
                    if (result.recordset.length > 0) {
                        socket_list['us_' + result.recordset[0].user_id] = { 'socket_id': client.id };
                        helper.Dlog(socket_list);
                        response = { "success": "true", "status": "1", "message": msg_success };
                    } else {
                        response = { "success": "false", "status": "0", "message": msg_invalidUser };
                    }
                    client.emit('UpdateSocket', response);
                })
                .catch(err => {
                    helper.ThrowSocketError(err, client, "UpdateSocket");
                });
            })

        })
    })


}