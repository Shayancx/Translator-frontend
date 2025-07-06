require 'roda'
require 'net/http'
require 'uri'

class App < Roda
  plugin :public, root: '.'
  plugin :json
  plugin :halt
  plugin :request_headers

  LIBRETRANSLATE_URL = 'http://192.168.2.77:5000'

  route do |r|
    r.public

    r.root do
      response['Content-Type'] = 'text/html'
      File.read('index.html')
    end

    # Test page
    r.get 'test' do
      response['Content-Type'] = 'text/html'
      File.read('test-api.html')
    end

    # Proxy all LibreTranslate endpoints
    r.on 'languages' do
      r.get do
        uri = URI("#{LIBRETRANSLATE_URL}/languages")
        response = Net::HTTP.get_response(uri)
        response.body
      end
    end

    r.on 'frontend' do
      r.on 'settings' do
        r.get do
          uri = URI("#{LIBRETRANSLATE_URL}/frontend/settings")
          response = Net::HTTP.get_response(uri)
          response.body
        end
      end
    end

    r.on 'detect' do
      r.post do
        uri = URI("#{LIBRETRANSLATE_URL}/detect")
        http = Net::HTTP.new(uri.host, uri.port)
        request = Net::HTTP::Post.new(uri)
        request.set_form_data(r.params)
        response = http.request(request)
        response.body
      end
    end

    r.on 'translate' do
      r.post do
        uri = URI("#{LIBRETRANSLATE_URL}/translate")
        http = Net::HTTP.new(uri.host, uri.port)
        request = Net::HTTP::Post.new(uri)
        request.set_form_data(r.params)
        response = http.request(request)
        response.body
      end
    end

    # Keep the search endpoint
    r.on 'search' do
      r.get do
        # Return empty array for now to avoid Elasticsearch errors
        []
      end
    end
  end
end
