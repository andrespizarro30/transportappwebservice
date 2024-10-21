var db = require('./../helpers/db_helpers')
var helper = require('./../helpers/helpers')
var multiparty = require('multiparty')
var fs = require('fs');
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

//User Type:
const ut_admin = 4
const ut_driver = 2
const ut_user = 1

module.exports.controller = (app, io, socket_list) => {

    const msg_success = "successfully";
    const msg_fail = "fail";
    const msg_invalidUser = "invalid username";

    app.post('/api/add_car', (req, res) => {

        var form = new multiparty.Form();
        form.parse(req, (err, reqObj, files) => {
            if (err) {
                helper.ThrowHtmlError(err, res);
                return;
            }

            checkAccessToken(req.headers, res, (uObj) => {
                helper.CheckParameterValid(res, reqObj, ["brand", "model", "series", "seat", "other_status", "car_number"], () => {

                    helper.CheckParameterValid(res, files, ["image"], () => {

                        var responseObj = { "status": "0", "message": "Car add fail" };

                        switch (reqObj.other_status.toString()) {
                            case "0":
                                user_car_add(uObj.user_id, reqObj.series[0], reqObj.car_number[0], files.image[0], (resObj) => {
                                    res.json(resObj);
                                })
                                break;
                            case "1":
                                // new brand, new model, new series add
                                car_brand_add(reqObj.brand[0], (brand_id) => {
                                    car_model_add(brand_id, reqObj.model[0], reqObj.seat[0], (model_id) => {
                                        car_series_add(brand_id, model_id, reqObj.series[0], (series_id) => {
                                            user_car_add(uObj.user_id, series_id, reqObj.car_number[0], files.image[0], (resObj) => {
                                                res.json(resObj);
                                            })
                                        })
                                    })
                                })
                                break;
                            case "2":
                                // exits brand, new model, new series add

                                car_model_add(reqObj.brand[0], reqObj.model[0], reqObj.seat[0], (model_id) => {
                                    car_series_add(reqObj.brand, model_id, reqObj.series[0], (series_id) => {
                                        user_car_add(uObj.user_id, series_id, reqObj.car_number[0], files.image[0], (resObj) => {
                                            res.json(resObj);
                                        })
                                    })
                                })

                                break;

                            case "3":
                                // exits brand, exits model, new series add
                                car_series_add(reqObj.brand[0], reqObj.model[0], reqObj.series[0], (series_id) => {
                                    user_car_add(uObj.user_id, series_id, reqObj.car_number[0], files.image[0], (resObj) => {
                                        res.json(resObj);
                                    })
                                })
                                break;

                            default:
                                break;
                        }

                    })
                })

            }, "2")

        })

    })

    app.post('/api/car_list', (req, res) => {
        checkAccessToken(req.headers, res, (uObj) => {

            sql.connect(config).then(pool => {
                return pool.request()
                    .input('user_id', sql.Int, uObj.user_id)
                    .input('status', sql.Int, 2)
                    .query(`
                        SELECT uc.user_car_id, cs.series_name, cm.model_name, cb.brand_name, uc.car_number,
                            CASE WHEN uc.car_image != '' THEN CONCAT('${helper.ImagePath()}', uc.car_image) ELSE '' END AS car_image,
                            uc.status, sd.service_name, sd.service_id, ud.select_service_id,
                            ISNULL(zwcs.status, 0) AS service_status,
                            CASE WHEN uc.user_car_id = ud.car_id THEN 1 ELSE 0 END AS is_set_running
                        FROM user_cars AS uc
                        INNER JOIN car_series AS cs ON uc.series_id = cs.series_id
                        INNER JOIN car_model AS cm ON cm.model_id = cs.model_id
                        INNER JOIN car_brand AS cb ON cb.brand_id = cs.brand_id
                        INNER JOIN user_detail AS ud ON ud.user_id = uc.user_id
                        INNER JOIN zone_document AS zwd ON zwd.zone_id = ud.zone_id AND zwd.status = 1
                        INNER JOIN service_detail AS sd ON sd.service_id = zwd.service_id
                        LEFT JOIN zone_wise_cars_service AS zwcs ON zwcs.user_car_id = uc.user_car_id AND zwd.zone_doc_id = zwcs.zone_doc_id
                        WHERE uc.user_id = @user_id AND uc.status != @status
                        GROUP BY uc.user_car_id,cs.series_name,cm.model_name, brand_name, sd.service_id, uc.car_number,car_image,uc.status,sd.service_name,
                        ud.select_service_id,zwcs.status,ud.car_id
                        ORDER BY uc.user_car_id
                    `);
            }).then(result => {
                if (result.recordset.length > 0) {
                    let car_list = [];
                    let car_index = 0;
        
                    result.recordset.forEach((carDetail, index) => {
                        helper.Dlog(carDetail);
        
                        if (carDetail.series_name === "") {
                            carDetail.series_name = "-";
                        }
        
                        if (index === 0) {
                            car_list.push(carDetail);
                            car_list[car_index].active_status = 1;
                            car_list[car_index].service_missing_name = "";
                        } else if (carDetail.user_car_id !== car_list[car_index].user_car_id) {
                            car_list[car_index].service_missing_name = car_list[car_index].service_missing_name.replace(/,\s*$/, "");
                            car_list.push(carDetail);
                            car_index++;
                            car_list[car_index].active_status = 1;
                            car_list[car_index].service_missing_name = "";
                        }
        
                        if (carDetail.select_service_id !== "") {
                            carDetail.select_service_id.split(",").forEach(series_id => {
                                if (carDetail.service_status === 0 && series_id === carDetail.series_id) {
                                    car_list[car_index].service_missing_name += `${carDetail.series_name},`;
                                    car_list[car_index].active_status = 0;
                                }
                            });
                        }
                        delete car_list[car_index]["service_name"];
                        delete car_list[car_index]["service_status"];
                    });
        
                    car_list[car_index].service_missing_name = car_list[car_index].service_missing_name.replace(/,\s*$/, "");
        
                    res.json({ "status": "1", "payload": car_list });
        
                } else {
                    res.json({ "status": "0", "message": "no car" });
                }
            }).catch(err => {
                helper.ThrowHtmlError(err, res);
            });

        }, "2")

    })

    app.post('/api/car_delete', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["user_car_id"], () => {
                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('status', sql.Int, 2)
                        .input('user_car_id', sql.Int, reqObj.user_car_id)
                        .input('user_id', sql.Int, uObj.user_id)
                        .query('UPDATE user_cars SET status = @status WHERE user_car_id = @user_car_id AND user_id = @user_id')
                })
                .then(result => {
                    if (result.rowsAffected[0] > 0) {
                        res.json({ "status": "1", "message": "Car deleted successfully" });
                    } else {
                        res.json({ "status": "0", "message": msg_fail });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });    
            })
        }, "2")
    })

    app.post('/api/set_running_car', (req, res) => {
        helper.Dlog(req.body);
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["user_car_id"], () => {
                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('user_car_id', sql.Int, reqObj.user_car_id)
                        .input('user_id', sql.Int, uObj.user_id)
                        .input('status', sql.Int, 1)
                        .query(
                            `UPDATE user_detail 
                            SET user_detail.car_id = user_cars.user_car_id, user_detail.seat = car_model.seat 
                            FROM user_cars
                            INNER JOIN user_detail ON user_cars.user_id = user_detail.user_id 
                            INNER JOIN car_series ON car_series.series_id = user_cars.series_id 
                            INNER JOIN car_model ON car_series.model_id = car_model.model_id 
                            INNER JOIN car_brand ON car_brand.brand_id = car_series.brand_id 
                            WHERE user_cars.user_car_id = @user_car_id 
                            AND user_cars.user_id = @user_id 
                            AND user_cars.status = @status`
                        );
                })
                .then(result => {
                    if (result.rowsAffected[0] > 0) {
                        return sql.connect(config).then(pool => {
                            return pool.request()
                                .input('user_car_id', sql.Int, reqObj.user_car_id)
                                .input('status', sql.Int, 1)
                                .query(
                                    `SELECT uc.user_car_id, cs.series_name, cm.model_name, cb.brand_name, uc.car_number, 
                                    (CASE WHEN uc.car_image != '' THEN CONCAT('${helper.ImagePath()}', uc.car_image) ELSE '' END) AS car_image, 
                                    uc.status, (CASE WHEN uc.user_car_id = ud.car_id THEN 1 ELSE 0 END) AS is_set_running 
                                    FROM user_cars AS uc 
                                    INNER JOIN car_series AS cs ON uc.series_id = cs.series_id 
                                    INNER JOIN car_model AS cm ON cm.model_id = cs.model_id 
                                    INNER JOIN car_brand AS cb ON cb.brand_id = cs.brand_id 
                                    INNER JOIN user_detail AS ud ON ud.user_id = uc.user_id 
                                    WHERE uc.user_car_id = @user_car_id AND uc.status = @status`
                                );
                        });
                    } else {
                        res.json({ "status": "0", "message": `${msg_fail}-2` });
                    }
                })
                .then(result => {
                    if (result.recordset.length > 0) {
                        result.recordset.forEach((serObj, index) => {
                            if (serObj.series_name === "") {
                                result.recordset[index].series_name = "-";
                            }
                        });
                        res.json({ "status": "1", "payload": result.recordset, "message": "car set running successfully" });
                    } else {
                        res.json({ "status": "0", "message": `${msg_fail}-1` });
                    }
                })
                .catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        }, "2")
    })

    app.post('/api/brand_list', (req, res) => {
        checkAccessToken(req.headers, res, (uObj) => {
            sql.connect(config).then(pool => {
                return pool.request()
                    .input('status', sql.Int, 2)
                    .query('SELECT brand_id, brand_name FROM car_brand WHERE status != @status');
            }).then(result => {
                const other_dict = { 'brand_id': 0, 'brand_name': "Other" };
        
                if (result.recordset.length > 0) {
                    result.recordset.push(other_dict);
                    res.json({ "status": "1", "payload": result.recordset });
                } else {
                    res.json({ "status": "1", "payload": [other_dict] });
                }
            }).catch(err => {
                helper.ThrowHtmlError(err, res);
            });
        })

    })

    app.post('/api/model_list', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["brand_id"], () => {
                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('brand_id', sql.Int, reqObj.brand_id)
                        .input('status', sql.Int, 2)
                        .query('SELECT cm.model_id, cm.model_name, cm.seat FROM car_model AS cm ' +
                               'INNER JOIN car_brand AS cb ON cb.brand_id = cm.brand_id AND cm.brand_id = @brand_id ' +
                               'WHERE cm.status != @status');
                }).then(result => {
                    const other_dict = { 'model_id': 0, 'model_name': "Other", "seat": "0" };
            
                    if (result.recordset.length > 0) {
                        result.recordset.push(other_dict);
                        res.json({ "status": "1", "payload": result.recordset });
                    } else {
                        res.json({ "status": "1", "payload": [other_dict] });
                    }
                }).catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })

        })

    })

    app.post('/api/series_list', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {

            helper.CheckParameterValid(res, reqObj, ["model_id"], () => {
                sql.connect(config).then(pool => {
                    return pool.request()
                        .input('model_id', sql.Int, reqObj.model_id)
                        .input('status', sql.Int, 2)
                        .query('SELECT cs.series_id, cs.series_name FROM car_series AS cs ' +
                               'INNER JOIN car_model AS cm ON cm.model_id = cs.model_id AND cs.model_id = @model_id ' +
                               'WHERE cs.status != @status');
                }).then(result => {
                    const other_dict = { 'series_id': 0, 'series_name': "Other" };
                    const seriesList = result.recordset;
            
                    if (seriesList.length > 0) {
                        seriesList.forEach((serObj, index) => {
                            if (serObj.series_name === "") {
                                seriesList[index].series_name = "-";
                            }
                        });
                        seriesList.push(other_dict);
                        res.json({ "status": "1", "payload": seriesList });
                    } else {
                        res.json({ "status": "1", "payload": [other_dict] });
                    }
                }).catch(err => {
                    helper.ThrowHtmlError(err, res);
                });
            })
        })

    })

    app.post('/api/subscription_plan_list', (req, res) => {
        helper.Dlog(req.body)
        checkAccessToken(req.headers, res, (uObj) => {
            db.query(" SELECT `sp`.`plan_id`, `sp`.`plan_name`,`sp`.`detail`, `sp`.`days`, `sp`.`amount`,`sp`.`max_discount`,`sp`.`max_ride`, `sp`.`zone_id`, `sp`.`service_id`, `sp`.`min_amount`, `sp`.`discount_per`, `sp`.`image`, `sb`.`user_typ`, `sp`.`start_date`, `sp`.`end_date`, `sp`.`created_date`, `zl`.`zone_name`, GROUP_CONCAT(`sp`.`service_name`) AS `service_name`     FROM `subscription_plan` AS `sp` " +
            "INNER JOIN `zone_list` AS  `zl` ON `zl`.`zone_id` = `sp`.`zone_id` " +
            "INNER JOIN `service_detail` AS `sd` ON FIND_IN_SET(`sd`.`service_id`, `sp`.`service_id` ) != 0 AND `sd`.`status` = 1  " +
            "WHERE `sp`.`status` = 1 AND `sp`.`start_date` >= NOW() AND `sp`.`end_date` <= NOW() GROUP BY `sp`.`plan_id` ", [], (err, result) => {
                if(err) {
                    helper.ThrowHtmlError(err, res);
                    return
                }

                res.json(
                    {
                        "status": "1",
                        "payload": result
                    }
                )
            }  )
        } )
    } )

    app.post('/api/admin/add_car', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["brand", "model", "series", "seat", "other_status"], () => {

                var responseObj = { "status": "0", "message": "Car add fail" };

                switch (reqObj.other_status.toString()) {
                    case "0":
                        res.json({ "status": "1", "message": msg_success })
                        break;
                    case "1":
                        // new brand, new model, new series add
                        car_brand_add(reqObj.brand, (brand_id) => {
                            car_model_add(brand_id, reqObj.model, reqObj.seat, (model_id) => {
                                car_series_add(brand_id, model_id, reqObj.series, (series_id) => {
                                    res.json({ "status": "1", "message": msg_success })
                                })
                            })
                        })
                        break;
                    case "2":
                        // exits brand, new model, new series add

                        car_model_add(reqObj.brand, reqObj.model, reqObj.seat, (model_id) => {
                            car_series_add(reqObj.brand, model_id, reqObj.series, (series_id) => {
                                res.json({ "status": "1", "message": msg_success })
                            })
                        })

                        break;

                    case "2":
                        // exits brand, exits model, new series add
                        car_series_add(reqObj.brand, reqObj.model, reqObj.series, (series_id) => {
                            res.json({ "status": "1", "message": msg_success })
                        })
                        break;

                    default:
                        break;
                }

            })

        }, "4")

    })

    app.post('/api/admin/brand_list', (req, res) => {
        checkAccessToken(req.headers, res, (uObj) => {
            db.query('SELECT `brand_id`, `brand_name`, `status`, `created_date`, `modify_date` FROM `car_brand` WHERE `status` != ?', [2], (err, result) => {
                if (err) {
                    helper.ThrowHtmlError(err);
                    return
                }

                if (result.length > 0) {
                    res.json({ "status": "1", "payload": result })

                } else {
                    res.json({ "status": "0", "message": "no brand added" })
                }
            })
        }, "4")

    })

    app.post('/api/admin/model_list', (req, res) => {
        checkAccessToken(req.headers, res, (uObj) => {
            db.query('SELECT `cm`.`model_id`, `cb`.`brand_name`, `cm`.`brand_id`, `cm`.`model_name`, `cm`.`seat`, `cm`.`status`, `cm`.`created_date`, `cm`.`modify_date` FROM `car_model` AS `cm` ' +
                'INNER JOIN `car_brand` AS `cb` ON `cb`.`brand_id` = `cm`.`brand_id` '
                + ' WHERE `cm`.`status` != ?', [2], (err, result) => {
                    if (err) {
                        helper.ThrowHtmlError(err);
                        return
                    }
                    if (result.length > 0) {
                        res.json({ "status": "1", "payload": result })

                    } else {
                        res.json({ "status": "0", "message": "no brand added" })
                    }
                })
        }, "4")

    })

    app.post('/api/admin/series_list', (req, res) => {
        checkAccessToken(req.headers, res, (uObj) => {
            db.query('SELECT `cm`.`model_id`, `cm`.`model_name`, `cb`.`brand_name`, `cm`.`brand_id`, `cs`.`series_id`,  `cs`.`series_name`, `cs`.`status`, `cs`.`created_date`, `cs`.`modify_date` FROM `car_series` AS `cs` ' +
                'INNER JOIN `car_model` AS `cm` ON `cm`.`model_id` = `cs`.`model_id` ' +
                'INNER JOIN `car_brand` AS `cb` ON `cb`.`brand_id` = `cs`.`brand_id` ' +
                ' WHERE `cs`.`status` != ?', [2], (err, result) => {
                    if (err) {
                        helper.ThrowHtmlError(err);
                        return
                    }
                    if (result.length > 0) {
                        result.forEach((serObj, index) => {
                            if (serObj.series_name == "") {
                                result[index].series_name = "-"
                            }
                        });
                        res.json({ "status": "1", "payload": result })

                    } else {
                        res.json({ "status": "0", "message": "no brand added" })
                    }
                })
        }, "4")

    })

    app.post('/api/admin/brand_approved', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["brand_id"], () => {

                db.query('UPDATE `car_brand` AS `cb` ' +

                    'SET `cb`.`modify_date` = NOW(), `cb`.`status` = (CASE WHEN `cb`.`status` = 0 THEN 1 ELSE 0 END) ' +

                    ' WHERE `cb`.`brand_id` = ? AND `cb`.`status` != ? ', [reqObj.brand_id, 2], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                        }
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": msg_success })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })
            })
        }, "4")

    })

    app.post('/api/admin/model_approved', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;

        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["model_id"], () => {

                db.query('UPDATE `car_model` AS `cm` ' +
                    'INNER JOIN `car_brand` AS `cb` ON `cm`.`brand_id` = `cb`.`brand_id` ' +
                    'SET `cb`.`modify_date` = NOW(), `cb`.`status` = (CASE WHEN `cb`.`status` = 0 THEN 1 ELSE 0 END), `cm`.`modify_date` = NOW(), `cm`.`status` = (CASE WHEN `cm`.`status` = 0 THEN 1 ELSE 0 END) ' +

                    ' WHERE `cm`.`model_id` = ? AND `cm`.`status` != ? ', [reqObj.model_id, 2], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                            return
                        }

                        helper.Dlog(result);
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": msg_success })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })
            })
        }, "4")

    })

    app.post('/api/admin/series_approved', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["series_id"], () => {

                db.query('UPDATE `car_series` AS `cs` ' +
                    'INNER JOIN `car_model` AS `cm` ON `cm`.`model_id` = `cs`.`model_id` ' +
                    'INNER JOIN `car_brand` AS `cb` ON `cs`.`brand_id` = `cb`.`brand_id` ' +
                    'SET `cb`.`modify_date` = NOW(), `cb`.`status` = (CASE WHEN `cb`.`status` = 0 THEN 1 ELSE 0 END), `cm`.`modify_date` = NOW(), `cm`.`status` = (CASE WHEN `cm`.`status` = 0 THEN 1 ELSE 0 END), `cs`.`modify_date` = NOW(), `cs`.`status` = (CASE WHEN `cs`.`status` = 0 THEN 1 ELSE 0 END) ' +

                    ' WHERE `cs`.`series_id` = ? AND `cs`.`status` != ? ', [reqObj.series_id, 2], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                        }
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": msg_success })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })
            })
        }, "4")

    })


    app.post('/api/admin/brand_delete', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["brand_id"], () => {

                db.query('UPDATE `car_brand` AS `cb` ' +
                    'LEFT JOIN `car_model` AS `cm` ON `cb`.`brand_id` = `cm`.`brand_id` ' +
                    'LEFT JOIN `car_series` AS `cs` ON `cs`.`model_id` = `cm`.`model_id` ' +
                    'SET `cm`.`modify_date` = NOW(), `cm`.`status` = 2,' +
                    '`cb`.`modify_date` = NOW(), `cb`.`status` = 2, ' +
                    '`cs`.`modify_date` = NOW(), `cs`.`status` = 2 ' +
                    ' WHERE `cb`.`brand_id` = ? ', [reqObj.brand_id], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                        }
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": msg_success })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })


            })

        }, "4")

    })

    app.post('/api/admin/model_delete', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["model_id"], () => {

                db.query('UPDATE `car_model` AS `cm` ' +
                    'LEFT JOIN `car_series` AS `cs` ON `cs`.`model_id` = `cm`.`model_id` ' +
                    'SET `cm`.`modify_date` = NOW(), `cm`.`status` = 2, `cs`.`modify_date` = NOW(), `cs`.`status` = 2 ' +
                    ' WHERE `cm`.`model_id` = ? ', [reqObj.model_id], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                            return;
                        }
                        
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": msg_success })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })


            })

        }, "4")

    })

    app.post('/api/admin/series_delete', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;
        checkAccessToken(req.headers, res, (uObj) => {
            helper.CheckParameterValid(res, reqObj, ["series_id"], () => {

                db.query('UPDATE `car_series` AS `cs` SET `cs`.`modify_date` = NOW(), `cs`.`status` = 2 ' +
                    ' WHERE `cs`.`series_id` = ? ', [reqObj.series_id], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                        }
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": msg_success })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })


            })

        }, "4")

    })


    app.post('/api/admin/add_subscription_plan', (req, res) => {

        var form = new multiparty.Form();
        form.parse(req, (err, reqObj, files) => {
            if (err) {
                helper.ThrowHtmlError(err, res);
                return;
            }

            checkAccessToken(req.headers, res, (uObj) => {
                helper.CheckParameterValid(res, reqObj, ["plan_name", "plan_details", "user_type", "days", "zone_id", "service_id", "min_amount", "max_ride", "max_discount", "discount_per", "amount", "start_date", "end_date"], () => {

                    helper.CheckParameterValid(res, files, ["image"], () => {

                        var extension = files.image[0].originalFilename.substring(files.image[0].originalFilename.lastIndexOf(".") + 1);
                        var imageFileName = "subscription_plan/" + helper.fileNameGenerate(extension);

                        var newPath = imageSavePath + imageFileName;

                        fs.rename(files.image[0].path, newPath, (err) => {

                            if (err) {
                                helper.ThrowHtmlError(err);
                                return;
                            } else {
                                db.query("INSERT INTO `subscription_plan`( `plan_name`, `detail`, `days`, `amount`, `max_discount`, `max_ride`, `zone_id`, `service_id`, `min_amount`, `discount_per`, `image`, `user_type`, `start_date`, `end_date`) VALUES (?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,? )", [
                                    reqObj.plan_name[0], reqObj.plan_details[0], reqObj.days[0], reqObj.amount[0], reqObj.max_discount[0], reqObj.max_ride[0], reqObj.zone_id[0], reqObj.service_id[0], reqObj.min_amount[0], reqObj.discount_per[0], imageFileName, reqObj.user_type[0], reqObj.start_date[0], reqObj.end_date[0],
                                ], (err, result) => {
                                    if (err) {
                                        helper.ThrowHtmlError(err, res);
                                        return
                                    }

                                    if (result) {
                                        res.json({ "status": "1", "message": "subscription plan added successfully" })
                                    } else {
                                        res.json({ "status": "0", "message": msg_fail })
                                    }
                                })

                            }
                        })

                    })
                })

            }, ut_admin)

        })

    })

    app.post('/api/admin/edit_subscription_plan', (req, res) => {

        var form = new multiparty.Form();
        form.parse(req, (err, reqObj, files) => {
            if (err) {
                helper.ThrowHtmlError(err, res);
                return;
            }

            checkAccessToken(req.headers, res, (uObj) => {
                helper.CheckParameterValid(res, reqObj, ["plan_id", "plan_name", "plan_details", "user_type", "days", "zone_id", "service_id", "min_amount", "max_ride", "max_discount", "discount_per", "amount", "start_date", "end_date"], () => {


                    var condition = ""

                    if (files.image) {
                        var extension = files.image[0].originalFilename.substring(files.image[0].originalFilename.lastIndexOf(".") + 1);
                        var imageFileName = "subscription_plan/" + helper.fileNameGenerate(extension);

                        var newPath = imageSavePath + imageFileName;
                        condition = " `image ` = ? '" + imageFileName + "' , "
                        fs.rename(files.image[0].path, newPath, (err) => {

                            if (err) {
                                helper.ThrowHtmlError(err);
                                return;
                            }
                        })
                    }

                    db.query("UPDATE `subscription_plan` SET `plan_name` = ?, `detail`= ?, `days`= ?, `amount`= ?, `max_discount`= ?, `max_ride`= ?, `zone_id`= ?, `service_id`= ?, `min_amount`= ?, `discount_per`= ?, " + condition + " `user_type` = ? , `start_date` = ?, `end_date` = ? WHERE `plan_id` = ? AND `start_date` > NOW() ", [
                        reqObj.plan_name[0], reqObj.plan_details[0], reqObj.days[0], reqObj.amount[0], reqObj.max_discount[0], reqObj.max_ride[0], reqObj.zone_id[0], reqObj.service_id[0], reqObj.min_amount[0], reqObj.discount_per[0], imageFileName, reqObj.user_type[0], reqObj.start_date[0], reqObj.end_date[0], reqObj.plan_id[0]
                    ], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                            return
                        }

                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": "subscription plan update successfully" })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })

                })


            }, ut_admin)

        })

    })

    app.post('/api/admin/delete_subscription_plan', (req, res) => {
        helper.Dlog(req.body)
        var reqObj = req.body;

            checkAccessToken(req.headers, res, (uObj) => {
                helper.CheckParameterValid(res, reqObj, ["plan_id"], () => {

                    db.query("UPDATE `subscription_plan` SET `status` = ?, `modify_date`= ? WHERE `plan_id` = ? ", [
                        reqObj.plan_id
                    ], (err, result) => {
                        if (err) {
                            helper.ThrowHtmlError(err, res);
                            return
                        }
                        if (result.affectedRows > 0) {
                            res.json({ "status": "1", "message": "subscription plan deleted successfully" })
                        } else {
                            res.json({ "status": "0", "message": msg_fail })
                        }
                    })

                })
            }, ut_admin)
    })

    app.post('/api/admin/subscription_plan_list', (req, res) => {
        checkAccessToken(req.headers, res, (uObj) => {

            db.query("SELECT `sp`.`plan_id`, `sp`.`plan_name`, `sp`.`detail`, `sp`.`days`, `sp`.`amount`, `sp`.`max_discount`, `sp`.`max_ride`, `sp`.`zone_id`, `sp`.`service_id`, `sp`.`min_amount`, `sp`.`discount_per`, `sp`.`image`, `sp`.`user_type`, `sp`.`start_date`, `sp`.`end_date`, `sp`.`status`, `sp`.`created_date`, `sp`.`modify_date`, GROUP_CONCAT(`sd`.`service_name` ) AS `service_name`, `zl`.`zone_name` FROM `subscription_plan` AS `sp` " +
                "INNER JOIN`zone_list` AS`zl` ON`zl`.`zone_id` = `sp`.`zone_id` " +
                "INNER JOIn`service_detail` AS`sd` ON FIND_IN_SET(`sd`, `service_id`, `sp`.`service_id`) != 0 AND`sd`.`status` = 1 " +
                "WHERE`sp`.`status` != 2 AND`sp`.`user_type` = 1 GROUP BY`sp`.`plan_id` ORDER BY`sp`.`plan_id` DESC;" +
                "SELECT `service_id`, `service_name` FROM `service_detail` WHERE `status` != 2 ;" +
                "SELECT `zone_id`, `zone_name` FROM `zone_list` WHERE `status` != 2;", [], (err, result) => {
                    if (err) {
                        helper.ThrowHtmlError(err, res);
                    }
                    res.json({
                        "status": "1", "payload": {
                            "subscription_plan": result[0],
                            "service_list": result[1],
                            "zone_list": result[2]
                        }
                    })
                })
        }, ut_admin)

    })

    app.post('/api/upload_image', (req, res) => {
        var form = new multiparty.Form();
        form.parse(req, (err, reqObj, files) => {
            if (err) {
                helper.ThrowHtmlError(err, res);
                return;
            }

            helper.Dlog("--------------- Parameter --------------")
            helper.Dlog(reqObj);

            helper.Dlog("--------------- Files --------------")
            helper.Dlog(files);

            if (files.image != undefined || files.image != null) {
                var extension = files.image[0].originalFilename.substring(files.image[0].originalFilename.lastIndexOf(".") + 1);
                var imageFileName = helper.fileNameGenerate(extension);

                var newPath = imageSavePath + imageFileName;

                fs.rename(files.image[0].path, newPath, (err) => {

                    if (err) {
                        helper.ThrowHtmlError(err);
                        return;
                    } else {

                        var name = reqObj.name;
                        var address = reqObj.address;

                        helper.Dlog(name);
                        helper.Dlog(address);

                        res.json({
                            "status": "1",
                            "payload": { "name": name, "address": address, "image": helper.ImagePath() + imageFileName },
                            "message": msg_success
                        })
                    }
                })
            }
        })
    })

}

function car_brand_add(car_brand, callback) {
    sql.query`
        SELECT brand_id, brand_name, status, created_date, modify_date
        FROM car_brand
        WHERE brand_name = ${car_brand.toUpperCase()}
    `
    .then(result => {
        if (result.recordset.length > 0) {
            // Brand exists, perform an update
            return sql.query`
                UPDATE car_brand
                SET modify_date = CASE WHEN status = 2 THEN GETDATE() ELSE modify_date END,
                    status = CASE WHEN status = 2 THEN 0 ELSE status END
                WHERE brand_id = ${result.recordset[0].brand_id}
            `
            .then(() => callback(result.recordset[0].brand_id))
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback(null);
            });
        } else {
            // Brand does not exist, perform an insert
            return sql.query`
                INSERT INTO car_brand (brand_name)
                VALUES (${car_brand.toUpperCase()});
                SELECT SCOPE_IDENTITY() AS brand_id;
            `
            .then(insertResult => callback(insertResult.recordset[0].brand_id))
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback(null);
            });
        }
    })
    .catch(err => {
        helper.ThrowHtmlError(err);
        callback(null);
    });
}

function car_model_add(brand_id, car_model, seat, callback) {
    // Check if the model exists
    sql.query`
        SELECT model_id, brand_id, model_name, seat, status, created_date, modify_date
        FROM car_model
        WHERE brand_id = ${brand_id} AND model_name = ${car_model.toUpperCase()} AND seat = ${seat}
    `
    .then(result => {
        if (result.recordset.length > 0) {
            // Model exists, perform an update
            return sql.query`
                UPDATE car_brand AS cb
                INNER JOIN car_model AS cm ON cb.brand_id = cm.brand_id
                SET cm.modify_date = CASE WHEN cm.status = 2 THEN GETDATE() ELSE cm.modify_date END,
                    cm.status = CASE WHEN cm.status = 2 THEN 0 ELSE cm.status END,
                    cb.modify_date = CASE WHEN cb.status = 2 THEN GETDATE() ELSE cb.modify_date END,
                    cb.status = CASE WHEN cb.status = 2 THEN 0 ELSE cb.status END
                WHERE cm.model_id = ${result.recordset[0].model_id}
            `
            .then(() => callback(result.recordset[0].model_id))
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback(null);
            });
        } else {
            // Model does not exist, perform an insert
            return sql.query`
                INSERT INTO car_model (brand_id, model_name, seat)
                VALUES (${brand_id}, ${car_model.toUpperCase()}, ${seat});
                SELECT SCOPE_IDENTITY() AS model_id;
            `
            .then(insertResult => callback(insertResult.recordset[0].model_id))
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback(null);
            });
        }
    })
    .catch(err => {
        helper.ThrowHtmlError(err);
        callback(null);
    });
}

function car_series_add(brand_id, model_id, car_series, callback) {
    sql.query`
        SELECT series_id, brand_id, model_id, series_name, status, created_date, modify_date
        FROM car_series
        WHERE brand_id = ${brand_id} AND model_id = ${model_id} AND series_name = ${car_series.toUpperCase()}
    `
    .then(result => {
        if (result.recordset.length > 0) {
            // Series exists, perform an update
            return sql.query`
                UPDATE car_brand AS cb
                INNER JOIN car_model AS cm ON cb.brand_id = cm.brand_id
                INNER JOIN car_series AS cs ON cs.model_id = cm.model_id
                SET cm.modify_date = CASE WHEN cm.status = 2 THEN GETDATE() ELSE cm.modify_date END,
                    cm.status = CASE WHEN cm.status = 2 THEN 0 ELSE cm.status END,
                    cb.modify_date = CASE WHEN cb.status = 2 THEN GETDATE() ELSE cb.modify_date END,
                    cb.status = CASE WHEN cb.status = 2 THEN 0 ELSE cb.status END,
                    cs.modify_date = CASE WHEN cs.status = 2 THEN GETDATE() ELSE cs.modify_date END,
                    cs.status = CASE WHEN cs.status = 2 THEN 0 ELSE cs.status END
                WHERE cs.series_id = ${result.recordset[0].series_id}
            `
            .then(() => callback(result.recordset[0].series_id))
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback(null);
            });
        } else {
            // Series does not exist, perform an insert
            return sql.query`
                INSERT INTO car_series (brand_id, model_id, series_name)
                VALUES (${brand_id}, ${model_id}, ${car_series})
                SELECT SCOPE_IDENTITY() AS series_id
            `
            .then(insertResult => callback(insertResult.recordset[0].series_id))
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback(null);
            });
        }
    })
    .catch(err => {
        helper.ThrowHtmlError(err);
        callback(null);
    });
}

function user_car_add(user_id, series_id, car_number, car_image_path, callback) {

    // Check if the car already exists
    sql.query`
        SELECT user_car_id
        FROM user_cars
        WHERE user_id = ${user_id} AND series_id = ${series_id} AND car_number = ${car_number} AND status != 2
    `
    .then(result => {
        if (result.recordset.length == 0) {
            // Car does not exist, proceed with file operations and insertion
            var extension = car_image_path.originalFilename.substring(car_image_path.originalFilename.lastIndexOf(".") + 1);
            var imageFileName = "car/" + helper.fileNameGenerate(extension);
            var newPath = imageSavePath + imageFileName;

            // Rename (move) the file
            return new Promise((resolve, reject) => {
                fs.rename(car_image_path.path, newPath, err => {
                    if (err) {
                        helper.ThrowHtmlError(err);
                        reject(err);
                    } else {
                        helper.Dlog("image save done");
                        resolve(imageFileName);
                    }
                });
            })
            .then(imageFileName => {
                // Insert new car record
                helper.Dlog(`${user_id}-${series_id}-${car_number}-${imageFileName}`);
                return sql.query`
                    INSERT INTO user_cars (user_id, series_id, car_number, car_image)
                    VALUES (${user_id}, ${series_id}, ${car_number}, ${imageFileName})
                `;
            })
            .then(() => {
                callback({ status: "1", message: "car added successfully" });
            })
            .catch(err => {
                helper.ThrowHtmlError(err);
                callback({ status: "0", message: msg_fail });
            });
        } else {
            // Car already exists
            callback({ status: "0", message: "this car already added" });
        }
    })
    .catch(err => {
        helper.ThrowHtmlError(err);
        callback({ status: "0", message: msg_fail });
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
                .query(`
                    SELECT user_id, name, email, gender, mobile, mobile_code, auth_token, user_type, is_block, image, status
                    FROM user_detail
                    WHERE auth_token = @auth_token
                    AND (status = @status1 OR status = @status2)
                `);
        }).then(result => {
            helper.Dlog(result.recordset);
            if (result.recordset.length > 0) {
                const user = result.recordset[0];
                if (requireType !== "") {
                    if (requireType == user.user_type) {
                        callback(result.recordset[0]);
                    } else {
                        res.json({ "status": "0", "code": "404", "message": "Access denied. Unauthorized user access 1." });
                    }
                } else {
                    callback(result.recordset[0]);
                }
    
            } else {
                res.json({ "status": "0", "code": "404", "message": "Access denied. Unauthorized user access 2." });
            }
        }).catch(err => {
            helper.ThrowHtmlError(err);
        });
    })
}