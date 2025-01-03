var db = require('./../helpers/db_helpers')
var helper = require('./../helpers/helpers')
var multiparty = require('multiparty')
var fs = require('fs');
const { duration } = require('moment-timezone');
var imageSavePath = "./public/img/";

const { GoogleAuth } = require('google-auth-library');

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

var sql = require('mssql');

// const config = {
//     user: 'andresp',
//     password: '123456',
//     server: '192.168.10.22',
//     port: 1433,
//     database: 'taxi_app',
//     "options":{
//         "encrypt":true,
//         "trustServerCertificate": true
//     }
// }

const config = {
  user: 'xxxxx',
  password: 'xxxxxx',
  server: 'xxxxxxx.database.windows.net',
  port: 1433,
  database: 'xxxxxxx',
  "options":{
      "encrypt":true,
      "trustServerCertificate": true
  }
}

var controllerIO;
var controllerSocketList;

var admin_fire;


module.exports.controller = (app, io, socket_list, admin) => {

    controllerIO = io;
    controllerSocketList = socket_list;

    admin_fire = admin;

    //App Api

    app.post('/api/races',(req,res)=>{

        var reqObj = req.body;

        sql.connect(config).then((pool) => {
            return pool
              .request()
              .query(
                `SELECT * FROM rt_races ORDER BY dates DESC`
              );
          })
          .then((result) => {
            const races = result.recordsets[0];
        
            if (races.length > 0) {
                res.json({
                    status: '1',
                    payload: races,
                    message: 'Races list',
                  });
            } else {
              res.json({ status: '0', message: 'No races available'});
            }
          })
          .catch((err) => {
            //helper.ThrowHtmlError(err, res);
            res.json({ status: '100', message: err});
          });

    });

    app.post('/api/add_competitor', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        sql.connect(config).then((pool) => {
            return pool
              .request()
              .input('competitor_id', sql.VarChar, reqObj.competitor_id)
              .input('race_id', sql.VarChar, reqObj.race_id)
              .query(
                `SELECT * FROM rt_races_competitors WHERE competitor_id=@competitor_id AND race_id=@race_id`
              );
          })
          .then((result) => {
            const competitor = result.recordsets[0];
            if (competitor.length == 0) {
                sql.connect(config).then((pool) => {
                    return pool
                      .request()
                      .input('competitor_id', sql.VarChar, reqObj.competitor_id)
                      .input('race_id', sql.VarChar, reqObj.race_id)
                      .input('distance_runned', sql.VarChar, reqObj.distance_runned)
                      .input('time_runned', sql.VarChar, reqObj.time_runned)
                      .input('speed', sql.VarChar, reqObj.speed)
                      .input('latitude', sql.VarChar, reqObj.latitude)
                      .input('longitude', sql.VarChar, reqObj.longitude)
                      .input('name', sql.VarChar, reqObj.name)
                      .query(
                        `INSERT INTO rt_races_competitors(competitor_id, race_id, distance_runned, time_runned, 
                        speed, latitude, longitude, name)
                            VALUES (@competitor_id, @race_id, @distance_runned, @time_runned, @speed, @latitude, @longitude, @name);`
                      );
                  })
                  .then((finalResult) => {
                    if (finalResult.rowsAffected.length > 0) {
                        res.json({
                            status: '1',
                            message: 'Competidor ingresado',
                          });

                        const response = {
                            "status": "1",
                            "payload": reqObj,
                        };

                        Object.entries(controllerSocketList).forEach(([key, value]) => {
                            helper.Dlog(value.socket_id);
                            controllerIO.sockets.sockets.get(value.socket_id).emit("racer_data_updated", response);
                        });

                    } else {
                      res.json({ status: '0', message: 'error al ingresar' });
                    }
                  })
                  .catch((err) => {
                    res.json({ status: '0', message: 'error al ingresar' });
                  });                
            } else {
                sql.connect(config).then((pool) => {
                    return pool
                      .request()
                      .input('competitor_id', sql.VarChar, reqObj.competitor_id)
                      .input('race_id', sql.VarChar, reqObj.race_id)
                      .input('distance_runned', sql.VarChar, reqObj.distance_runned)
                      .input('time_runned', sql.VarChar, reqObj.time_runned)
                      .input('speed', sql.VarChar, reqObj.speed)
                      .input('latitude', sql.VarChar, reqObj.latitude)
                      .input('longitude', sql.VarChar, reqObj.longitude)
                      .query(
                        `UPDATE rt_races_competitors SET distance_runned=@distance_runned, time_runned=@time_runned, 
                        speed=@speed, latitude=@latitude, longitude=@longitude 
                        WHERE competitor_id=@competitor_id AND race_id=@race_id`
                      );
                  })
                  .then((finalResult) => {
                    if (finalResult.rowsAffected.length > 0) {
                        res.json({
                            status: '1',
                            message: 'Competidor actualizado',
                          });

                        const response = {
                            "status": "1",
                            "payload": reqObj,
                        };

                        let raceId = reqObj.race_id.replace('-','').replace('-','');
                        raceId = raceId.replace(' ','');
                        raceId = raceId.toLowerCase();

                        Object.entries(controllerSocketList).forEach(([key, value]) => {
                            helper.Dlog(value.socket_id);
                            if (value.socket_id && controllerIO.sockets.sockets.has(value.socket_id)) {
                                controllerIO.sockets.sockets.get(value.socket_id).emit(`racer_data_updated_${raceId}`, response);
                            } else {
                                console.log(`Socket with ID ${value.socket_id} not found or not connected. socket: ${raceId}`);
                            }
                        });
                        
                    } else {
                      res.json({ status: '0', message: 'error al actualizar' });
                    }
                  })
                  .catch((err) => {
                    helper.Dlog(err);
                    res.json({ status: '0', message: 'error al actualizar' });
                  });
            }
          })
          .catch((err) => {
            //helper.ThrowHtmlError(err, res);
            res.json({ status: '100', message: err});
          });
        
    });

    app.post('/api/save_racer_image', (req, res) => {

      helper.Dlog(req.body);

      var reqObj = req.body;

      var form = new multiparty.Form();
      form.parse(req, (err, reqObj, files) => {
          console.log(err);
          if (err) {
              console.log(err);
              helper.ThrowHtmlError(err, res);
              return
          }

          helper.CheckParameterValid(res, files, ["image"], () => {
            helper.uploadRacerImageToFirebase(files.image[0],reqObj.file_name,'racers_profile', admin_fire,(imgPath)=>{
                if (imgPath == "error") {
                    helper.ThrowHtmlError(err, res);
                    return;
                } else {
                  res.json({ "status": "1", "message": "Image profile saved" });
                }

            })
        })

      })

  })

}