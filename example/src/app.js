var React = require('react'),
	MyComponent = require('my-component');

var App = React.createClass({
	render: function() {
		return (
			<div>
				<MyComponent />
			</div>
		)
	}
});

React.render(<App />, document.getElementById('app'));
