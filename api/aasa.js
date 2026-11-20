// Apple universal links: lets iOS open app.letsjamnow.com pool/crew/result/invite links straight in the app.
const body = JSON.stringify({
  applinks: {
    details: [{
      appIDs: ['ADAMUBVY3F.com.joyride.bondi'],
      components: [
        { '/': '/p/*' },
        { '/': '/c/*' },
        { '/': '/r/*' },
        { '/': '/', '?': { i: '?*' } },
      ],
    }],
  },
});

module.exports = (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(body);
};
