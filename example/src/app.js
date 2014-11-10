var React = require('react'),
	ExampleComponent = require('react-component-starter');

var App = React.createClass({
	render: function() {
		return (
			<div>
				<ExampleComponent />
			</div>
		)
	}
});

React.render(<App />, document.getElementById('app'));
