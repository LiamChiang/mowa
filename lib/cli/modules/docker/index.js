const path = require('path');
const nodemiral = require( 'nodemiral');
const {runTaskList} = require( '../../utils');

exports.help = function (api) {
  api.log('verbose', 'exec => mup docker help');
};

exports.setup = function (api) {
  log('exec => mup docker setup');
  const list = nodemiral.taskList('Setup Docker');

  list.executeScript('setup docker', {
    script: path.resolve(__dirname, 'assets/docker-setup.sh')
  });

  const sessions = api.getSessions([ 'meteor', 'mongo', 'proxy' ]);
  const rsessions = sessions.reduce((prev, curr) => {
    if (prev.map(session => session._host).indexOf(curr._host) === -1) {
      prev.push(curr);
    }
    return prev;
  }, []);

  return runTaskList(list, rsessions);
};
