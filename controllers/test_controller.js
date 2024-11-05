module.exports.controller = (app, io, user_socket_connect_list, admin) => {

    console.log("Test controller loaded");

    app.get('/testtest2', (req, res) => {
      res.send("Test route working!");
    });
  };