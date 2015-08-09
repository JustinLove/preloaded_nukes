(function() {
  console.log('puppetmaster')

  api.Holodeck.prototype.raycastWithPlanet = function(x, y) {
    var config = {
      points: [[x, y]],
      terrain: true,
      units: false,
      features: false
    };
    return engine.call('holodeck.raycast', this.id, JSON.stringify(config)).then(function(raw) {
      var result = raw ? JSON.parse(raw) : null;
      if (_.isObject(result)) {
        var hitResults = result.results || [];
        if (typeof(result.planet) != 'undefined') {
          _.forEach(hitResults, function(hit) {
            hit.planet = result.planet;
          });
        }
        result = hitResults[0];
      }
      return result;
    });
  };

  // Ping / Ping throttling
  var mouseX = 0
  var mouseY = 0
  var hdeck = model.holodeck
  var mousetrack = function(e) {
    mouseX = e.offsetX
    mouseY = e.offsetY
    hdeck = $(this).data('holodeck')
  }

  var lastPingTime = 0
  var ping = function() {
    lastPingTime = Date.now()
    hdeck.unitCommand('ping', mouseX, mouseY, false)
  }

  var maybePing = function() {
    if (Date.now() - lastPingTime > 500) {
      setTimeout(ping, 0)
    }
  }

  // Spectator Announcement, including drop-pod effect
  var lastHover = {name: '', spec: ''}
  var selectedUnit = lastHover

  handlers.puppetmasterUnitSelected = function(spec) {
    var unit = model.unitSpecs[spec]
    selectedUnit = {spec: spec, name: (unit && loc(unit.name)) || 'unknown'}
  }

  var liveGameHover = handlers.hover
  handlers.hover = function(payload) {
    liveGameHover(payload)

    if (payload) {
      lastHover = {spec: payload.spec_id || '', name: loc(payload.name) || 'unknown'}
    }
  }

  var locationEvents = function(alerts) {
    alerts.forEach(function(alert) {
      var paste = dropPodQueue.shift()
      if (!paste) return
      setTimeout(function() {
        pasteUnits3D(paste.count, {
          army: alert.army_id,
          what: paste.spec,
          planet: alert.planet_id,
          location: alert.location
        })
      }, paste.time - Date.now())
    })
  }

  if (!handlers.watch_list) {
    // make sure alerts are enabled for this scene
    handlers.watch_list = function(payload) {}
  }
  // alertsManger isn't passing through our events, so we have to go upstream
  setTimeout(function() {
    var liveGameWatchList = handlers.watch_list
    handlers.watch_list = function(payload) {
      if (liveGameWatchList) liveGameWatchList(payload)

      if (payload) {
        //locationEvents(payload.list.filter(dropPodEvent))
      }
    }
  }, 0)

  var announceGift = function(who, count, what) {
    model.send_message("team_chat_message",
      {message: ['Puppetmaster gives', who, count.toString(), what].join(' ')});
  }

  var selectedPlayer = ko.computed(function() {
    var index = model.playerControlFlags().indexOf(true)
    if (index == -1) {
      return 'nobody'
    } else {
      return model.players()[index]
    }
  })

  var dropPodSpec = "/pa/puppetmaster/drop_pod_launcher.json"

  var dropPod = function() {
    engineCall("unit.debug.setSpecId", dropPodSpec)
    engineCall("unit.debug.paste")
  }

  var dropPodEvent = function(alert) {
    return (alert.watch_type == constants.watch_type.death &&
      alert.spec_id == dropPodSpec)
  }

  // Count tracking
  var pasteCount = ko.observable(0)
  pasteCount.subscribe(function(count) {
    api.panels.devmode && api.panels.devmode.message('pasteCount', parseInt(count, 10));
  })
  var pasteUnit = {spec: '', name: ''}
  var pasteReset = null
  var resetCount = function() {
    if (pasteCount() > 0) {
      announceGift(selectedPlayer().name, pasteCount(), pasteUnit.name)
    }

    pasteCount(0)
    clearTimeout(pasteReset)
    pasteReset = null
  }
  var increment = function(n) {
    if (selectedUnit.spec != pasteUnit.spec) {
      resetCount()
    }
    pasteUnit = selectedUnit
    pasteCount(pasteCount() + parseInt(n, 10))
    clearTimeout(pasteReset)
    pasteReset = setTimeout(resetCount, 2000)
  }

  // API Hook
  var engineCall = engine.call
  var puppet = function(method) {
    if (method == 'unit.debug.paste') {
      console.log("Sorry, you're a puppet")
      return undefined;
    } else {
      return engineCall.apply(this, arguments);
    }
  }
  var puppetmaster = function(method) {
    if (method == 'unit.debug.paste') {
      pasteUnits(1)
      return
    } else if (method == 'unit.debug.copy') {
      selectedUnit = lastHover
    } else if (method == 'unit.debug.setSpecId') {
      var spec = arguments[1]
      var unit = model.unitSpecs[spec]
      selectedUnit = {spec: spec, name: (unit && loc(unit.name)) || 'unknown'}
    }

    return engineCall.apply(this, arguments);
  }

  var dropPodQueue = []
  var pasteUnits = function(n) {
    if (!model.cheatAllowCreateUnit()) return
    if (n < 1) return
    var army_id = selectedPlayer().id
    if (typeof(army_id) == 'undefined') return

    hdeck.raycastWithPlanet(mouseX, mouseY).then(function(result) {
      var drop = {
        army: army_id,
        what: dropPodSpec,
        planet: result.planet,
        location: result.pos,
      }
      pasteUnits3D(1, drop)
      drop.what = selectedUnit.spec
      setTimeout(function() {
        pasteUnits3D(n, drop)
      }, 5000)
    })
    increment(n)
    maybePing()
  }

  var pasteUnits3D = function(n, config) {
    if (!model.cheatAllowCreateUnit()) return
    if (n < 1) return

    for (var i = 0;i < n;i++) {
      model.send_message('create_unit', config)
    }
  }

  model.pasteBurst = 10
  // stub: for Bulk Paste Units compatibility
  if (action_sets.hacks.bulk_paste_unit.stub) {
    action_sets.hacks.bulk_paste_unit = function() {
      pasteUnits(model.pasteBurst)
    }
  }

  // Power control
  var live_game_server_state = handlers.server_state
  handlers.server_state = function(msg) {
    if (msg.data && msg.data.client && msg.data.client.game_options) {
      msg.data.client.game_options.sandbox = false
    }

    live_game_server_state.call(this, msg)
  }

  var hasBeenPlayer = !model.isSpectator()

  model.isSpectator.subscribe(function(value) {
    if (value == false) {
      hasBeenPlayer = true
    }
  })

  var enableCheats = function() {
    if (hasBeenPlayer) return

    model.cheatAllowChangeControl(true)
    model.cheatAllowCreateUnit(true)
    model.sandbox(true)
    model.gameOptions.sandbox(true)
    engine.call = puppetmaster
    $('body').on('mousemove', 'holodeck', mousetrack)
    setTimeout(function() {
      api.panels.sandbox && api.panels.sandbox.message('puppetmasterOpenSandbox')
    }, 100)
  }

  var disableCheats = function() {
    model.devMode(false)
    model.cheatAllowChangeControl(false)
    model.cheatAllowCreateUnit(false)
    model.sandbox(false)
    model.gameOptions.sandbox(false)
    engine.call = puppet
    $('body').off('mousemove', 'holodeck', mousetrack)
  }

  var toggleCheats = function() {
    console.log('toggle')
    if (model.cheatAllowCreateUnit()) {
      disableCheats()
    } else {
      enableCheats()
    }
  }

  action_sets.hacks.toggle_puppetmaster = toggleCheats

  // Enable spectator panel updates while open
  var previousPlayerControl = -1
  handlers.puppetmasterSpectatorPanelStatus = function(status) {
    if (model.cheatAllowChangeControl()) {
      if (status) {
        previousPlayerControl = model.playerControlFlags().indexOf(true)
        model.observerModeCalledOnce(false)
        model.startObserverMode()
      } else if (previousPlayerControl != -1) {
        api.panels.devmode.message('puppetmasterRestoreControl', previousPlayerControl)
      }
    }
  }

  model.pasteUnits = pasteUnits

  api.Panel.message('', 'inputmap.reload');
  disableCheats()
})()
