require 'rack/cors'
require_relative 'app'

use Rack::Cors do
  allow do
    origins 'localhost:3000', '127.0.0.1:3000', 'http://localhost:4567', 'http://127.0.0.1:4567'

    resource '*',
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head]
  end
end

run App